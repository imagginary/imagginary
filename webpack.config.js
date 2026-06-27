const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  entry: './src/index.tsx',
  target: 'web',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    // './' so script/asset URLs are relative — required for file:// loading in packaged Electron.
    // Dev server handles both '/' and './' transparently.
    publicPath: './',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript',
            ],
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: [
                  require('@tailwindcss/postcss'),
                ],
              },
            },
          },
        ],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html',
    }),
    new webpack.DefinePlugin({
      'process.env.UMAMI_WEBSITE_ID':       JSON.stringify(process.env.UMAMI_WEBSITE_ID       ?? ''),
      'process.env.DODO_STARTER_CREDITS_URL':  JSON.stringify(process.env.DODO_STARTER_CREDITS_URL  ?? ''),
      'process.env.DODO_STANDARD_CREDITS_URL': JSON.stringify(process.env.DODO_STANDARD_CREDITS_URL ?? ''),
      'process.env.DODO_POWER_CREDITS_URL':    JSON.stringify(process.env.DODO_POWER_CREDITS_URL    ?? ''),
    }),
  ],
  devServer: {
    port: 3000,
    hot: true,
    static: {
      directory: path.join(__dirname, 'public'),
    },
  },
};
