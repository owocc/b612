'use client';

import { useState, type ReactNode } from 'react';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { VStack } from '@astryxdesign/core/Stack';

/**
 * 角色详情页的「档案 / 形象资产」切换壳。
 * 档案与资产面板都由服务端渲染后作为节点传入，这里只负责本地切换，避免整页重载。
 */
export function CharacterDetailTabs({
  profile,
  assets,
  assetCount,
}: {
  profile: ReactNode;
  assets: ReactNode;
  assetCount: number;
}) {
  const [tab, setTab] = useState<'profile' | 'assets'>('profile');

  return (
    <VStack gap={4}>
      <TabList value={tab} onChange={(value) => setTab(value as 'profile' | 'assets')} hasDivider>
        <Tab value="profile" label="档案" />
        <Tab value="assets" label={assetCount > 0 ? `形象资产 (${assetCount})` : '形象资产'} />
      </TabList>
      {tab === 'profile' ? profile : assets}
    </VStack>
  );
}
