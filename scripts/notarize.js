'use strict';
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  if (!process.env.APPLE_API_KEY_ID) {
    console.log('Skipping notarization — APPLE_API_KEY_ID not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing: ${appPath}`);
  console.log(`Key ID: ${process.env.APPLE_API_KEY_ID}`);
  console.log(`Issuer: ${process.env.APPLE_API_ISSUER}`);
  console.log(`Key set: ${!!process.env.APPLE_API_KEY}`);

  const keyPath = `/tmp/AuthKey_${process.env.APPLE_API_KEY_ID}.p8`;
  require('fs').writeFileSync(keyPath, process.env.APPLE_API_KEY);

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
    console.error('Notarization failed:', err);
    throw err;
  } finally {
    require('fs').unlinkSync(keyPath);
  }
};
