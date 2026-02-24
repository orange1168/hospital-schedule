import { PropsWithChildren } from 'react';
import { useLaunch } from '@tarojs/taro';
import { injectH5Styles } from '@/utils/h5-styles';
import { enableWxDebugIfNeeded } from '@/utils/wx-debug';
import '@/app.css';

export default ({ children }: PropsWithChildren<any>) => {
  useLaunch(() => {
    enableWxDebugIfNeeded();
    injectH5Styles();
  });

  return children;
};
