import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { env } from '../config/env.js';

authenticator.options = { window: 1, step: 30 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(label: string, secret: string): string {
  return authenticator.keyuri(label, env.TOTP_ISSUER, secret);
}

export async function buildQrDataUrl(otpauthUrl: string): Promise<string> {
  return qrcode.toDataURL(otpauthUrl);
}

export function verifyTotp(token: string, secret: string): boolean {
  return authenticator.verify({ token, secret });
}
