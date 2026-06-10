import 'dotenv/config';
import qrcode from 'qrcode';
import { connectMongo, disconnectMongo } from '../config/db.js';
import { User } from '../models/User.js';
import { buildOtpAuthUrl, generateTotpSecret } from '../utils/totp.js';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: pnpm --filter @tripbng/api exec tsx src/scripts/enrol-2fa.ts <email>');
    process.exit(2);
  }

  await connectMongo();

  const user = await User.findOne({ email }).select('+twoFactorSecret');
  if (!user) {
    console.error(`No user found with email: ${email}`);
    await disconnectMongo();
    process.exit(1);
  }

  const secret = generateTotpSecret();
  const otpauthUrl = buildOtpAuthUrl(user.email, secret);

  user.twoFactorSecret = secret;
  user.twoFactorEnabled = true;
  user.pendingTwoFactorSecret = null as unknown as string;
  await user.save();

  const qrAscii = await qrcode.toString(otpauthUrl, { type: 'terminal', small: true });

  console.log('');
  console.log(`2FA enrolled for ${user.email} (role: ${user.role})`);
  console.log('');
  console.log('Scan this QR with Google Authenticator / Authy:');
  console.log(qrAscii);
  console.log('Or enter the secret manually:');
  console.log(`  ${secret}`);
  console.log('');
  console.log(`otpauth URL: ${otpauthUrl}`);
  console.log('');

  await disconnectMongo();
}

main().catch(async (err) => {
  console.error('enrol-2fa failed:', err);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
