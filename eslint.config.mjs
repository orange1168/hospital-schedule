import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  ...compat.extends('taro/react'),
  {
    rules: {
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'jsx-quotes': ['error', 'prefer-double'],
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['src/network.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            '请勿在 src 目录下直接使用 process.env\n如需获取 URL 请求前缀，请使用已经注入全局的 PROJECT_DOMAIN()',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Taro',
          property: 'request',
          message: '请使用 Network.request 替代 Taro.request',
        },
        {
          object: 'Taro',
          property: 'uploadFile',
          message: '请使用 Network.uploadFile 替代 Taro.uploadFile',
        },
        {
          object: 'Taro',
          property: 'downloadFile',
          message: '请使用 Network.downloadFile 替代 Taro.downloadFile',
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'dist-*/**', 'node_modules/**'],
  },
];
