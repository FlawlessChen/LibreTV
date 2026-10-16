import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkUpstreamAllowed, isBlockedByDNS, isPrivateIP, isValidProxyUrl } from './ssrf';

const { resolve4, resolve6 } = vi.hoisted(() => ({
  resolve4: vi.fn<() => Promise<string[]>>(),
  resolve6: vi.fn<() => Promise<string[]>>(),
}));

vi.mock('node:dns/promises', () => ({ default: { resolve4, resolve6 } }));

describe('isPrivateIP', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['192.168.1.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['8.8.8.8', false],
    ['1.2.3.4', false],
    // URL.hostname 对 IPv6 会带方括号
    ['[::1]', true],
    ['[fe80::1]', true],
    ['[fd00::1]', true],
    ['[fc00::1]', true],
    // IPv4-mapped IPv6：十六进制形式与点分形式
    ['[::ffff:c0a8:164]', true], // ::ffff:192.168.1.100
    ['::ffff:192.168.1.100', true],
    ['[::ffff:7f00:1]', true], // ::ffff:127.0.0.1
    ['::ffff:127.0.0.1', true],
    ['[::ffff:a9fe:a9fe]', true], // ::ffff:169.254.169.254
    ['[::ffff:a00:1]', true], // ::ffff:10.0.0.1
    ['[::ffff:808:808]', false], // ::ffff:8.8.8.8 公网
    ['::ffff:8.8.8.8', false],
    ['[::ffff:c0a8:164', true], // 单边括号（异常输入）仍要拦
    ['[2606:4700::1111]', false], // 公网 IPv6 不应被误杀
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });
});

describe('isValidProxyUrl', () => {
  it('放行公网 http(s)', () => {
    expect(isValidProxyUrl('https://cdn.example.com/a.m3u8')).toBe(true);
    expect(isValidProxyUrl('http://1.2.3.4/x.ts')).toBe(true);
  });

  it('拦截内网与保留地址', () => {
    expect(isValidProxyUrl('http://localhost/x')).toBe(false);
    expect(isValidProxyUrl('http://127.0.0.1/x')).toBe(false);
    expect(isValidProxyUrl('http://192.168.1.1/x')).toBe(false);
    expect(isValidProxyUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('拦截带方括号的 IPv6 与 IPv4-mapped 写法', () => {
    expect(isValidProxyUrl('http://[::1]:8080/x')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:192.168.1.100]:8080/list.m3u')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fe80::1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fd00::1]/x')).toBe(false);
  });

  it('不误杀公网 IPv6', () => {
    expect(isValidProxyUrl('http://[2606:4700::1111]/x')).toBe(true);
  });

  it('拦截非 http 协议', () => {
    expect(isValidProxyUrl('file:///etc/passwd')).toBe(false);
    expect(isValidProxyUrl('ftp://x.com/a')).toBe(false);
    expect(isValidProxyUrl('not a url')).toBe(false);
  });
});

describe('DNS upstream validation', () => {
  beforeEach(() => {
    resolve4.mockReset().mockResolvedValue(['93.184.216.34']);
    resolve6.mockReset().mockResolvedValue(['2606:4700::1111']);
  });

  it('allows public IPv4 and IPv6 answers', async () => {
    expect(await checkUpstreamAllowed('https://cdn.example.com/video.m3u8')).toEqual({ ok: true });
  });

  it('blocks a private A record even when the AAAA lookup fails', async () => {
    resolve4.mockResolvedValue(['192.168.1.1']);
    resolve6.mockRejectedValue(new Error('ENODATA'));
    expect(await isBlockedByDNS('https://cdn.example.com/video.m3u8')).toBe(true);
  });

  it('blocks a private AAAA record even when public A records exist', async () => {
    resolve6.mockResolvedValue(['fd00::1']);
    expect(await isBlockedByDNS('https://cdn.example.com/video.m3u8')).toBe(true);
  });

  it('allows IPv6-only public hosts', async () => {
    resolve4.mockRejectedValue(new Error('ENODATA'));
    expect(await isBlockedByDNS('https://cdn.example.com/video.m3u8')).toBe(false);
  });

  it('allows IPv4-only public hosts', async () => {
    resolve6.mockRejectedValue(new Error('ENODATA'));
    expect(await isBlockedByDNS('https://cdn.example.com/video.m3u8')).toBe(false);
  });

  it('rejects targets when neither address family can be verified', async () => {
    resolve4.mockRejectedValue(new Error('SERVFAIL'));
    resolve6.mockRejectedValue(new Error('SERVFAIL'));
    expect(await checkUpstreamAllowed('https://cdn.example.com/video.m3u8')).toMatchObject({ ok: false });
  });

  it('rejects empty DNS answers', async () => {
    resolve4.mockResolvedValue([]);
    resolve6.mockResolvedValue([]);
    expect(await isBlockedByDNS('https://cdn.example.com/video.m3u8')).toBe(true);
  });

  it('checks literal addresses without DNS requests', async () => {
    expect(await isBlockedByDNS('http://192.168.1.1/video.m3u8')).toBe(true);
    expect(await isBlockedByDNS('https://8.8.8.8/video.m3u8')).toBe(false);
    expect(resolve4).not.toHaveBeenCalled();
    expect(resolve6).not.toHaveBeenCalled();
  });
});
