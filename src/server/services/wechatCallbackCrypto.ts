// ============================================================
// 企业微信回调消息加解密模块
// 实现企业微信「接收消息回调」的AES-256-CBC加解密协议
// 无需额外依赖，仅使用 Node.js 内置 crypto
// ============================================================

import crypto from 'crypto';

/** 回调配置 */
export interface WechatCallbackConfig {
  token: string;
  encodingAESKey: string;
  corpId: string;
}

/** 解密后的消息 */
export interface DecryptedMessage {
  toUserName: string;
  fromUserName: string;
  createTime: string;
  msgType: string;
  content: string;
  msgId: string;
  agentId: string;
  /** 原始解密后的纯文本XML */
  rawXml: string;
}

// ==================== 工具函数 ====================

function getAESKey(encodingAESKey: string): Buffer {
  return Buffer.from(encodingAESKey + '=', 'base64');
}

/** SHA1 签名 */
function sha1(data: string): string {
  return crypto.createHash('sha1').update(data, 'utf8').digest('hex');
}

/** PKCS7 补位长度 */
function pkcs7PadLength(buff: Buffer): number {
  return buff[buff.length - 1];
}

/** 去除 PKCS7 补位 */
function pkcs7Unpad(buff: Buffer): Buffer {
  const pad = pkcs7PadLength(buff);
  if (pad < 1 || pad > 32) return buff;
  return buff.subarray(0, buff.length - pad);
}

/** 添加 PKCS7 补位 */
function pkcs7Pad(buff: Buffer, blockSize: number = 32): Buffer {
  const pad = blockSize - (buff.length % blockSize);
  const padBuff = Buffer.alloc(pad, pad);
  return Buffer.concat([buff, padBuff]);
}

// ==================== 签名校验 ====================

/** 验证企业微信回调URL时的签名 */
export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  data: string,
  signature: string
): boolean {
  const arr = [token, timestamp, nonce, data].sort();
  const str = arr.join('');
  const expected = sha1(str);
  // 安全对比（防时序攻击）
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return expected === signature;
  }
}

// ==================== 解密 ====================

/**
 * 解密企业微信推送的消息
 * @param encodingAESKey 企微后台的43位EncodingAESKey
 * @param encryptedMsg 加密的消息体（<Encrypt> 标签内容）
 */
function decryptMsg(encodingAESKey: string, encryptedMsg: string): string {
  const aesKey = getAESKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);

  let decrypted: Buffer = Buffer.concat([
    decipher.update(Buffer.from(encryptedMsg, 'base64')),
    decipher.final(),
  ]) as Buffer;

  // 去除 PKCS7 补位
  decrypted = pkcs7Unpad(decrypted);

  // 格式：16字节随机 + 4字节msg_len(大端) + msg(xml) + corpId
  const msgLen = decrypted.readUInt32BE(16);
  const msg = decrypted.subarray(20, 20 + msgLen).toString('utf8');

  return msg;
}

// ==================== 加密 ====================

/**
 * 加密回复消息
 * @returns Base64 编码的加密消息（用于 <Encrypt> 标签）
 */
export function encryptMsg(
  encodingAESKey: string,
  corpId: string,
  plainXml: string
): string {
  const aesKey = getAESKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);

  // 16字节随机 + 4字节内容长度(网络字节序) + 内容 + corpId
  const random = crypto.randomBytes(16);
  const msgBuff = Buffer.from(plainXml, 'utf8');
  const lenBuff = Buffer.alloc(4);
  lenBuff.writeUInt32BE(msgBuff.length, 0);
  const corpIdBuff = Buffer.from(corpId, 'utf8');
  const raw = Buffer.concat([random, lenBuff, msgBuff, corpIdBuff]);

  // PKCS7 补位 + AES 加密
  const padded = pkcs7Pad(raw);
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

  return encrypted.toString('base64');
}

// ==================== 签名生成 ====================

/** 生成回复消息的签名 */
export function generateSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string
): string {
  const arr = [token, timestamp, nonce, encrypted].sort();
  return sha1(arr.join(''));
}

// ==================== 消息解析 ====================

/**
 * 从加密的POST body中解密并解析消息
 * @param xmlBody 企业微信POST的原始XML body
 * @param config 回调配置
 * @returns 解密后的消息，或 null（解析失败）
 */
export function parseEncryptedMessage(
  xmlBody: string,
  config: WechatCallbackConfig
): DecryptedMessage | null {
  try {
    // 1) 提取 <Encrypt> 内容
    const encMatch = xmlBody.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    if (!encMatch) return null;
    const encrypted = encMatch[1];

    // 2) 解密得到明文XML
    const decryptedXml = decryptMsg(config.encodingAESKey, encrypted);

    // 3) 简易XML解析（不使用xml2js，直接正则提取）
    const getTag = (tag: string): string => {
      const m = decryptedXml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`));
      if (m) return m[1];
      const m2 = decryptedXml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
      return m2 ? m2[1] : '';
    };

    return {
      toUserName: getTag('ToUserName'),
      fromUserName: getTag('FromUserName'),
      createTime: getTag('CreateTime'),
      msgType: getTag('MsgType'),
      content: getTag('Content'),
      msgId: getTag('MsgId'),
      agentId: getTag('AgentID'),
      rawXml: decryptedXml,
    };
  } catch (err) {
    console.error('[WechatCrypto] 解析消息失败:', err);
    return null;
  }
}

// ==================== GET验证 echostr 解密 ====================

/**
 * 解密GET请求中的 echostr
 * @returns 解密后的明文 echostr
 */
export function decryptEchostr(
  encodingAESKey: string,
  encryptedEchostr: string
): string {
  return decryptMsg(encodingAESKey, encryptedEchostr);
}

// ==================== 被动回复包装 ====================

/**
 * 生成被动回复的完整加密XML response
 * @param toUser 接收方（企微用户的UserID）
 * @param fromUser 发送方（应用AgentID）
 * @param content 回复的文本内容
 * @param config 回调配置
 * @returns 完整的XML回复字符串
 */
export function buildPassiveReply(
  toUser: string,
  fromUser: string,
  content: string,
  config: WechatCallbackConfig
): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = generateNonce();

  // 明文回复XML
  const plainXml =
    `<xml>` +
    `<ToUserName><![CDATA[${toUser}]]></ToUserName>` +
    `<FromUserName><![CDATA[${fromUser}]]></FromUserName>` +
    `<CreateTime>${timestamp}</CreateTime>` +
    `<MsgType><![CDATA[text]]></MsgType>` +
    `<Content><![CDATA[${content}]]></Content>` +
    `</xml>`;

  // 加密
  const encrypted = encryptMsg(config.encodingAESKey, config.corpId, plainXml);
  const signature = generateSignature(config.token, timestamp, nonce, encrypted);

  // 最终加密XML
  return (
    `<xml>` +
    `<Encrypt><![CDATA[${encrypted}]]></Encrypt>` +
    `<MsgSignature><![CDATA[${signature}]]></MsgSignature>` +
    `<TimeStamp>${timestamp}</TimeStamp>` +
    `<Nonce><![CDATA[${nonce}]]></Nonce>` +
    `</xml>`
  );
}

/** 生成随机 nonce */
function generateNonce(): string {
  return crypto.randomBytes(8).toString('hex');
}
