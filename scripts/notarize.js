'use strict';
const { notarize } = require('@electron/notarize');
const path = require('path');
const os = require('os');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  if (!process.env.APPLE_API_KEY_ID) {
    console.log('Skipping notarization — APPLE_API_KEY_ID not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const keyPath = path.join(os.homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${process.env.APPLE_API_KEY_ID}.p8`);

  console.log(`Notarizing: ${appPath}`);
  console.log(`Key ID: ${process.env.APPLE_API_KEY_ID}`);
  console.log(`Issuer: ${process.env.APPLE_API_ISSUER}`);
  console.log(`Key path: ${keyPath}`);
  console.log(`Key exists: ${require('fs').existsSync(keyPath)}`);

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleApiKey: keyPath,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
    });
    console.log('Notarization complete');
  } catch (err) {
    console.error('Notarization failed:', err.message);
    throw err;
  }
};
