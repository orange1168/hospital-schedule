#!/usr/bin/env node

console.log('🔴 Vercel Build Debug Information:');
console.log('==================================');
console.log('PROJECT_DOMAIN (build time):', process.env.PROJECT_DOMAIN || 'UNDEFINED');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('==================================');

// 继续执行原来的构建命令
const { execSync } = require('child_process');
try {
  execSync('pnpm build:web', { stdio: 'inherit' });
  console.log('✅ Build completed successfully');
} catch (error) {
  console.error('❌ Build failed');
  process.exit(1);
}
