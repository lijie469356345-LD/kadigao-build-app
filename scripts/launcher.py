import os
import sys
import subprocess
import time
import webbrowser
import signal
import logging
import codecs
from logging.handlers import TimedRotatingFileHandler

sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer)
sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer)

MAX_RESTARTS = 10
RESTART_DELAY = 5
LOG_MAX_BYTES = 10 * 1024 * 1024
LOG_BACKUP_COUNT = 5

def setup_logging(base_dir):
    log_dir = os.path.join(base_dir, 'logs')
    os.makedirs(log_dir, exist_ok=True)

    log_file = os.path.join(log_dir, 'cardigao_daemon.log')

    logger = logging.getLogger('CardigaoDaemon')
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

    file_handler = TimedRotatingFileHandler(
        log_file,
        when='D',
        interval=1,
        backupCount=LOG_BACKUP_COUNT,
        encoding='utf-8'
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger

def main():
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    os.chdir(base)

    if getattr(sys, '_MEIPASS', None):
        exe_dir = os.path.dirname(sys.executable)
        os.environ['CARDIGAO_BASE_DIR'] = exe_dir
    else:
        exe_dir = os.path.dirname(os.path.abspath(__file__))
        os.environ['CARDIGAO_BASE_DIR'] = exe_dir

    # config.json 优先用 exe 同目录的，没有则用内置兜底
    user_config = os.path.join(exe_dir, 'config.json')
    builtin_config = os.path.join(base, 'config.json')
    if os.path.exists(user_config):
        print(f'[Launcher] 使用外部配置: {user_config}')
    elif os.path.exists(builtin_config):
        print(f'[Launcher] 使用内置配置: {builtin_config}')

    node_exe = os.path.join(base, 'node.exe')
    server_js = os.path.join(base, 'server', 'server.js')

    if not os.path.exists(node_exe):
        print(f'ERROR: node.exe not found at {node_exe}')
        print(f'base dir: {base}')
        print(f'files in base: {os.listdir(base)[:20]}')
        return
    if not os.path.exists(server_js):
        print(f'ERROR: server.js not found at {server_js}')
        return

    logger = setup_logging(exe_dir)

    logger.info('=' * 50)
    logger.info('  卡迪高巡店系统 - 守护进程模式')
    logger.info(f'  工作目录: {base}')
    logger.info(f'  配置目录: {exe_dir}')
    logger.info('  正在启动服务: http://localhost:3000')
    logger.info('=' * 50)

    restart_count = 0
    first_start = True
    stopped = False

    def signal_handler(signum, frame):
        nonlocal stopped
        logger.info('收到停止信号，正在关闭服务...')
        stopped = True

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    while not stopped:
        if restart_count >= MAX_RESTARTS:
            logger.error(f'已达到最大重启次数 {MAX_RESTARTS}，守护进程退出')
            break

        try:
            proc = subprocess.Popen(
                [node_exe, server_js],
                cwd=base,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='replace',
                bufsize=1
            )

            logger.info(f'服务已启动，进程ID: {proc.pid}')

            if first_start:
                time.sleep(8)
                if proc.poll() is None:
                    try:
                        webbrowser.open('http://localhost:3000')
                        logger.info('已自动打开浏览器')
                    except Exception as e:
                        logger.warning(f'打开浏览器失败: {e}')
                first_start = False

            # 读取 stdout 和 stderr
            import threading
            def read_output(stream, prefix):
                try:
                    for line in iter(stream.readline, ''):
                        if line:
                            print(f'{prefix}{line.rstrip()}', flush=True)
                except:
                    pass

            t_stdout = threading.Thread(target=read_output, args=(proc.stdout, ''), daemon=True)
            t_stderr = threading.Thread(target=read_output, args=(proc.stderr, '[ERR] '), daemon=True)
            t_stdout.start()
            t_stderr.start()

            # 等待进程结束
            while proc.poll() is None and not stopped:
                time.sleep(0.5)

            # 等待线程读完剩余输出
            t_stdout.join(timeout=2)
            t_stderr.join(timeout=2)

            exit_code = proc.returncode
            logger.info(f'服务进程退出，退出码: {exit_code}')

            if stopped:
                break

            if exit_code == 0:
                logger.info('服务正常退出')
                break

            restart_count += 1
            logger.warning(f'服务异常退出，第 {restart_count}/{MAX_RESTARTS} 次重启...')

            if restart_count < MAX_RESTARTS:
                logger.info(f'等待 {RESTART_DELAY} 秒后重启...')
                for i in range(RESTART_DELAY, 0, -1):
                    if stopped:
                        break
                    time.sleep(1)

        except Exception as e:
            restart_count += 1
            logger.error(f'启动服务失败: {e}')
            import traceback
            logger.error(traceback.format_exc())
            if restart_count < MAX_RESTARTS:
                logger.info(f'等待 {RESTART_DELAY} 秒后重试...')
                time.sleep(RESTART_DELAY)

    logger.info('守护进程已停止。')
    print('\n按任意键退出...', flush=True)
    try:
        input()
    except:
        pass

if __name__ == '__main__':
    main()
