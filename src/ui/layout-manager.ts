/**
 * AIDOS Layout Manager
 *
 * tmux風のレイアウト管理を提供
 * - 動的なペイン分割
 * - フォーカス管理
 * - リサイズ対応
 */

import blessed from 'blessed';

// ========================================
// 型定義
// ========================================

export type LayoutMode = 'grid' | 'horizontal' | 'vertical' | 'custom';

export interface PaneConfig {
  id: string;
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
  label?: string;
  focusable?: boolean;
}

export interface LayoutConfig {
  mode: LayoutMode;
  panes: PaneConfig[];
}

export interface LayoutRegion {
  top: number;
  left: number;
  width: number;
  height: number;
}

// ========================================
// プリセットレイアウト
// ========================================

export const PRESET_LAYOUTS = {
  /**
   * 2x2グリッドレイアウト（4ペイン）
   */
  grid4: (): PaneConfig[] => [
    { id: 'pane-0', top: 0, left: 0, width: '50%', height: '50%' },
    { id: 'pane-1', top: 0, left: '50%', width: '50%', height: '50%' },
    { id: 'pane-2', top: '50%', left: 0, width: '50%', height: '50%' },
    { id: 'pane-3', top: '50%', left: '50%', width: '50%', height: '50%' },
  ],

  /**
   * 3分割レイアウト（均等）
   */
  threeColumn: (): PaneConfig[] => [
    { id: 'pane-0', top: 0, left: 0, width: '33%', height: '100%' },
    { id: 'pane-1', top: 0, left: '33%', width: '34%', height: '100%' },
    { id: 'pane-2', top: 0, left: '67%', width: '33%', height: '100%' },
  ],

  /**
   * メイン + サイドバーレイアウト
   */
  mainWithSidebar: (): PaneConfig[] => [
    { id: 'main', top: 0, left: 0, width: '70%', height: '100%' },
    { id: 'sidebar', top: 0, left: '70%', width: '30%', height: '100%' },
  ],

  /**
   * メイン + 下部ログパネル
   */
  mainWithLog: (): PaneConfig[] => [
    { id: 'main', top: 0, left: 0, width: '100%', height: '70%' },
    { id: 'log', top: '70%', left: 0, width: '100%', height: '30%' },
  ],

  /**
   * AIDOS標準レイアウト（ヘッダー + 3ペイン + ログ + フッター）
   */
  aidosStandard: (): PaneConfig[] => [
    { id: 'pane-0', top: 0, left: 0, width: '33%', height: '100%' },
    { id: 'pane-1', top: 0, left: '33%', width: '34%', height: '100%' },
    { id: 'pane-2', top: 0, left: '67%', width: '33%', height: '100%' },
  ],
};

// ========================================
// LayoutManager クラス
// ========================================

export class LayoutManager {
  private screen: blessed.Widgets.Screen;
  private container: blessed.Widgets.BoxElement;
  private panes: Map<string, blessed.Widgets.BoxElement> = new Map();
  private focusedPaneId: string | null = null;
  private layoutConfig: LayoutConfig;

  constructor(screen: blessed.Widgets.Screen, containerRegion: LayoutRegion) {
    this.screen = screen;
    this.layoutConfig = { mode: 'grid', panes: [] };

    // コンテナ作成
    this.container = blessed.box({
      parent: screen,
      top: containerRegion.top,
      left: containerRegion.left,
      width: containerRegion.width,
      height: containerRegion.height,
    });
  }

  /**
   * レイアウトを適用
   */
  applyLayout(config: LayoutConfig): void {
    // 既存ペインをクリア
    this.clearPanes();

    this.layoutConfig = config;

    // 新しいペインを作成
    for (const paneConfig of config.panes) {
      this.createPane(paneConfig);
    }

    // 最初のペインにフォーカス
    if (config.panes.length > 0) {
      this.focusPane(config.panes[0].id);
    }

    this.screen.render();
  }

  /**
   * プリセットレイアウトを適用
   */
  applyPreset(preset: keyof typeof PRESET_LAYOUTS): void {
    const panes = PRESET_LAYOUTS[preset]();
    this.applyLayout({ mode: 'custom', panes });
  }

  /**
   * ペインを作成
   */
  private createPane(config: PaneConfig): blessed.Widgets.BoxElement {
    const pane = blessed.box({
      parent: this.container,
      top: config.top,
      left: config.left,
      width: config.width,
      height: config.height,
      label: config.label ? ` ${config.label} ` : undefined,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'gray',
        },
        focus: {
          border: {
            fg: 'cyan',
          },
        },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      focusable: config.focusable !== false,
    });

    this.panes.set(config.id, pane);
    return pane;
  }

  /**
   * すべてのペインをクリア
   */
  private clearPanes(): void {
    for (const pane of this.panes.values()) {
      pane.destroy();
    }
    this.panes.clear();
    this.focusedPaneId = null;
  }

  /**
   * ペインを取得
   */
  getPane(id: string): blessed.Widgets.BoxElement | undefined {
    return this.panes.get(id);
  }

  /**
   * 全ペインを取得
   */
  getAllPanes(): Map<string, blessed.Widgets.BoxElement> {
    return this.panes;
  }

  /**
   * ペインにフォーカス
   */
  focusPane(id: string): boolean {
    const pane = this.panes.get(id);
    if (!pane) return false;

    // 前のフォーカスを解除
    if (this.focusedPaneId && this.focusedPaneId !== id) {
      const prevPane = this.panes.get(this.focusedPaneId);
      if (prevPane) {
        prevPane.style.border = { fg: 'gray' };
      }
    }

    // 新しいフォーカスを設定
    pane.style.border = { fg: 'cyan' };
    pane.focus();
    this.focusedPaneId = id;
    this.screen.render();

    return true;
  }

  /**
   * 次のペインにフォーカス
   */
  focusNext(): void {
    const paneIds = Array.from(this.panes.keys());
    if (paneIds.length === 0) return;

    const currentIndex = this.focusedPaneId
      ? paneIds.indexOf(this.focusedPaneId)
      : -1;
    const nextIndex = (currentIndex + 1) % paneIds.length;
    this.focusPane(paneIds[nextIndex]);
  }

  /**
   * 前のペインにフォーカス
   */
  focusPrevious(): void {
    const paneIds = Array.from(this.panes.keys());
    if (paneIds.length === 0) return;

    const currentIndex = this.focusedPaneId
      ? paneIds.indexOf(this.focusedPaneId)
      : 0;
    const prevIndex = (currentIndex - 1 + paneIds.length) % paneIds.length;
    this.focusPane(paneIds[prevIndex]);
  }

  /**
   * 現在フォーカスされているペインのIDを取得
   */
  getFocusedPaneId(): string | null {
    return this.focusedPaneId;
  }

  /**
   * ペインのラベルを更新
   */
  updatePaneLabel(id: string, label: string): void {
    const pane = this.panes.get(id);
    if (pane) {
      pane.setLabel(` ${label} `);
      this.screen.render();
    }
  }

  /**
   * ペインのボーダー色を更新
   */
  updatePaneBorderColor(id: string, color: string): void {
    const pane = this.panes.get(id);
    if (pane) {
      // フォーカスされていない場合のみ色を変更
      if (this.focusedPaneId !== id) {
        pane.style.border = { fg: color };
        this.screen.render();
      }
    }
  }

  /**
   * ペインの内容を更新
   */
  updatePaneContent(id: string, content: string): void {
    const pane = this.panes.get(id);
    if (pane) {
      pane.setContent(content);
      this.screen.render();
    }
  }

  /**
   * 動的にペインを追加
   */
  addPane(config: PaneConfig): blessed.Widgets.BoxElement {
    const pane = this.createPane(config);
    this.layoutConfig.panes.push(config);
    this.screen.render();
    return pane;
  }

  /**
   * ペインを削除
   */
  removePane(id: string): boolean {
    const pane = this.panes.get(id);
    if (!pane) return false;

    pane.destroy();
    this.panes.delete(id);
    this.layoutConfig.panes = this.layoutConfig.panes.filter(p => p.id !== id);

    // フォーカスが削除されたペインにあった場合、次のペインにフォーカス
    if (this.focusedPaneId === id) {
      const remainingIds = Array.from(this.panes.keys());
      if (remainingIds.length > 0) {
        this.focusPane(remainingIds[0]);
      } else {
        this.focusedPaneId = null;
      }
    }

    this.screen.render();
    return true;
  }

  /**
   * Agentの数に応じた動的レイアウトを生成
   */
  generateAgentLayout(agentCount: number): PaneConfig[] {
    if (agentCount <= 0) return [];
    if (agentCount === 1) {
      return [{ id: 'agent-0', top: 0, left: 0, width: '100%', height: '100%' }];
    }
    if (agentCount === 2) {
      return [
        { id: 'agent-0', top: 0, left: 0, width: '50%', height: '100%' },
        { id: 'agent-1', top: 0, left: '50%', width: '50%', height: '100%' },
      ];
    }
    if (agentCount === 3) {
      return PRESET_LAYOUTS.threeColumn().map((p, i) => ({ ...p, id: `agent-${i}` }));
    }
    if (agentCount === 4) {
      return PRESET_LAYOUTS.grid4().map((p, i) => ({ ...p, id: `agent-${i}` }));
    }

    // 5以上の場合はグリッド計算
    const cols = Math.ceil(Math.sqrt(agentCount));
    const rows = Math.ceil(agentCount / cols);
    const panes: PaneConfig[] = [];

    for (let i = 0; i < agentCount; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const widthPercent = Math.floor(100 / cols);
      const heightPercent = Math.floor(100 / rows);

      panes.push({
        id: `agent-${i}`,
        top: `${row * heightPercent}%`,
        left: `${col * widthPercent}%`,
        width: `${widthPercent}%`,
        height: `${heightPercent}%`,
      });
    }

    return panes;
  }

  /**
   * コンテナを取得
   */
  getContainer(): blessed.Widgets.BoxElement {
    return this.container;
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.clearPanes();
    this.container.destroy();
  }
}

export default LayoutManager;
