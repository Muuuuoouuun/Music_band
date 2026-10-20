// 이미 설치된 Playwright 를 그대로 쓴다 (브라우저나 패키지를 새로 받지 않음).
// PLAYWRIGHT_MODULE 에 전역 설치 경로를 줄 수 있다: $(npm root -g)/playwright/index.js
const mod = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
export const chromium = mod.chromium ?? mod.default?.chromium;
export const launchOptions = {
  ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
};
