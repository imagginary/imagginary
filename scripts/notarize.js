'use strict';
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  if (!process.env.APPLE_ID) {
    console.log('Skipping notarization — APPLE_ID not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing: ${appPath}`);
  console.log(`Apple ID: ${process.env.APPLE_ID}`);
  console.log(`Team ID: ${process.env.APPLE_TEAM_ID}`);
  console.log(`Password set: ${!!process.env.APPLE_APP_SPECIFIC_PASSWORD}`);

  return await notarize({
    tool: 'notarytool',
    appBundleId: 'com.imagginary.app',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
