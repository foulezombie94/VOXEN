const path = require('node:path');
module.exports = {
  target: 'web',
  entry: './src/renderer/main.jsx',
  output: { path: path.resolve(__dirname, 'dist/renderer'), filename: 'app.js', clean: true },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: { presets: [['@babel/preset-react', { runtime: 'automatic' }]] },
        },
      },
      {
        test: /\.module\.s[ac]ss$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: { modules: { localIdentName: '[name]__[local]__[hash:base64:5]' } },
          },
          'sass-loader',
        ],
      },
      {
        test: /\.s?css$/,
        exclude: /\.module\.s[ac]ss$/,
        use: ['style-loader', 'css-loader', 'sass-loader'],
      },
      {
        test: /\.(ttf|woff2?)$/,
        type: 'asset/resource',
        generator: { filename: 'assets/[name][ext]' },
      },
    ],
  },
  resolve: { extensions: ['.js', '.jsx'] },
  performance: { hints: false },
  devtool: false,
};
