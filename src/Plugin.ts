import debounce from 'lodash/debounce';
import type {
  App,
  HeadingCache,
  TFile,
} from 'obsidian';
import {
  MarkdownView,
  Plugin,
  PluginSettingTab,
  setIcon,
  Setting,
} from 'obsidian';
import defaultSetting from './defaultSetting';
import L from './L';
import { calcIndentLevels, getHeadings, isMarkdownFile, trivial } from './utils';

export default class StickyHaeddingsPlugin extends Plugin {
  settings: ISetting;
  fileResolveMap: Record<
    string,
    {
      resolve: boolean;
      file: TFile;
      view: MarkdownView;
      container: HTMLElement;
      lastHeight: number;
    }
  > = {};

  detectPosition = debounce(
    (event: Event) => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const target = event.target as HTMLElement | null;
      const scroller = target?.classList.contains('cm-scroller')
        || target?.classList.contains('markdown-preview-view');
      if (scroller) {
        const container = target?.closest('.view-content');
        if (container) {
          const ids = Object.keys(this.fileResolveMap).filter(
            id => this.fileResolveMap[id].container === container,
          );
          this.updateHeadings(ids);
        }
      }
    },
    20,
    { leading: true, trailing: true },
  );

  async onload() {
    await this.loadSettings();
    this.registerEvent(
      this.app.workspace.on('file-open', file => {
        if (file && isMarkdownFile(file)) {
          const activeView
            = this.app.workspace.getActiveViewOfType(MarkdownView);
          const id = activeView?.leaf.id;
          if (id) {
            if (!(id in this.fileResolveMap)) {
              activeView.onResize = this.makeResize(id);
            }
            this.fileResolveMap[id] = {
              resolve: true,
              file,
              container: activeView.contentEl,
              view: activeView,
              lastHeight: 0,
            };
            this.checkFileResolveMap();
            this.updateHeadings([id]);
          }
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.checkFileResolveMap();
        this.updateHeadings(Object.keys(this.fileResolveMap));
      }),
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', leaf => {
        if (leaf?.id && (leaf.view instanceof MarkdownView)) {
          this.checkFileResolveMap();
          this.updateHeadings([leaf.id]);
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor, info) => {
        const { file } = info;
        if (file && isMarkdownFile(file)) {
          Object.values(this.fileResolveMap).forEach(item => {
            if (item.file.path === file.path) {
              item.resolve = false;
            }
          });
        }
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on('resolve', file => {
        if (isMarkdownFile(file)) {
          const ids: string[] = [];
          Object.keys(this.fileResolveMap).forEach(id => {
            const item = this.fileResolveMap[id];
            if (item.file.path === file.path && !item.resolve) {
              item.resolve = true;
              ids.push(id);
            }
          });
          if (ids.length > 0) {
            this.checkFileResolveMap();
            this.updateHeadings(ids);
          }
        }
      }),
    );
    this.registerDomEvent(document, 'scroll', this.detectPosition, true);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    this.addSettingTab(new StickyHeadingsSetting(this.app, this));
  }

  checkFileResolveMap() {
    const validIds: string[] = [];
    this.app.workspace.iterateLeaves(
      this.app.workspace.getFocusedContainer(),
      leaf => {
        if (leaf.id) {
          validIds.push(leaf.id);
          if (!(leaf.id in this.fileResolveMap)) {
            if (leaf.view instanceof MarkdownView) {
              const file = leaf.view.getFile();
              if (file) {
                this.fileResolveMap[leaf.id] = {
                  resolve: true,
                  file,
                  container: leaf.view.contentEl,
                  view: leaf.view,
                  lastHeight: 0,
                };
              }
            }
          }
        }
      },
    );
    Object.keys(this.fileResolveMap).forEach(id => {
      if (!validIds.includes(id)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.fileResolveMap[id];
      }
    });
  }

  makeResize(id: string) {
    return () => {
      this.updateHeadings([id]);
    };
  }

  rerenderAll() {
    this.updateHeadings(Object.keys(this.fileResolveMap));
  }

  updateHeadings(ids: string[]) {
    ids.forEach(id => {
      const item = this.fileResolveMap[id];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (item) {
        const { file, view, container } = item;
        const headings = getHeadings(file, this.app);
        const scrollTop = view.currentMode.getScroll();
        this.renderHeadings(headings, container, scrollTop, view, id);
      }
    });
  }

  renderHeadings(
    headings: HeadingCache[] = [],
    container: HTMLElement,
    scrollTop: number,
    view: MarkdownView,
    id: string,
  ) {
    const validHeadings = headings.filter(
      heading => heading.position.end.line + 1 <= scrollTop,
    );
    let finalHeadings: HeadingCache[] = [];
    if (validHeadings.length) {
      trivial(validHeadings, finalHeadings, this.settings.mode);
    }
    let headingContainer = container.querySelector(
      '.sticky-headings-container',
    );
    if (!headingContainer) {
      const headingRoot = createDiv({ cls: 'sticky-headings-root' });
      headingContainer = headingRoot.createDiv({ cls: 'sticky-headings-container' });
      container.prepend(headingRoot);
    }
    headingContainer.empty();
    if (this.settings.max) {
      finalHeadings = finalHeadings.slice(-this.settings.max);
    }
    const indentLevels: number[] = calcIndentLevels(finalHeadings);
    finalHeadings.forEach((heading, i) => {
      let cls = `sticky-headings-item sticky-headings-level-${heading.level}`
      const headingItem = createDiv({
          cls,
          text: heading.heading
      })
      headingItem.setAttribute('data-indent-level', `${indentLevels[i]}`);
      if (this.settings.indicators) {
          const icon = createDiv({ cls: 'sticky-headings-icon' })
          setIcon(icon, `heading-${heading.level}`)
          headingItem.prepend(icon)
        }
        if (this.settings.style === 'default') {
          const wrapper = createDiv({
            cls: `HyperMD-header HyperMD-header-${heading.level}`
          })
          wrapper.append(headingItem)
          headingContainer.append(wrapper)
      } else {
          headingContainer.append(headingItem)
      }
      headingItem.addEventListener('click', () => { 
        // @ts-expect-error typing error
        view.currentMode.applyScroll(heading.position.start.line, { highlight: true });
        setTimeout(() => {
          // wait for headings tree rendered
          // @ts-expect-error typing error
          view.currentMode.applyScroll(heading.position.start.line, { highlight: true });
        }, 20);
      });
    });
    const newHeight = headingContainer.scrollHeight;
    const offset = newHeight - this.fileResolveMap[id].lastHeight;
    headingContainer.parentElement!.style.height = newHeight + 'px';
    const contentElement = container.querySelectorAll<HTMLElement>('.markdown-source-view, .markdown-reading-view');
    contentElement.forEach(item => {
      const scroller = item.querySelector('.cm-scroller, .markdown-preview-view');
      item.style.paddingTop = newHeight + 'px';
      scroller?.scrollTo({ top: scroller.scrollTop + offset, behavior: 'instant' });
    });
    this.fileResolveMap[id].lastHeight = newHeight;
  }

  onunload() {}

  async loadSettings() {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    this.settings = { ...defaultSetting, ...(await this.loadData() as ISetting) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class StickyHeadingsSetting extends PluginSettingTab {
  plugin: StickyHaeddingsPlugin;
  render: (settings: ISetting) => void;

  constructor(app: App, plugin: StickyHaeddingsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  update(data: ISetting) {
    this.plugin.settings = data;
    this.plugin.saveSettings();
    this.plugin.rerenderAll();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(L.setting.mode.title())
      .setDesc(L.setting.mode.description())
      .addDropdown(dropdown => {
        dropdown.addOption('default', L.setting.mode.default());
        dropdown.addOption('concise', L.setting.mode.concise());
        dropdown.setValue(this.plugin.settings.mode);
        dropdown.onChange(value => {
          this.update({
            ...this.plugin.settings,
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            mode: value as 'default' | 'concise',
          });
        });
      });
    new Setting(containerEl)
      .setName(L.setting.max.title())
      .setDesc(L.setting.max.description())
      .addText(text => {
        text.setValue(this.plugin.settings.max.toString());
        text.onChange(value => {
          this.update({
            ...this.plugin.settings,
            max: parseInt(value, 10) || 0,
          });
        });
      });
    new Setting(containerEl)
      .setName(L.setting.indicators.title())
      .setDesc(L.setting.indicators.description())
      .addToggle((toggle) => {
        toggle
            .setValue(this.plugin.settings.indicators)
            .onChange((boolean) => {
                this.update({
                    ...this.plugin.settings,
                    indicators: boolean
                })
            })
      })
    new Setting(containerEl)
      .setName(L.setting.style.title())
      .setDesc(L.setting.style.description())
      .addDropdown((dropdown) => {
          dropdown.addOption('simple', L.setting.style.simple())
          dropdown.addOption('default', L.setting.style.default())
          dropdown.setValue(this.plugin.settings.style)
          dropdown.onChange((value) => {
              this.update({
                  ...this.plugin.settings,
                  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                  style: value as 'simple' | 'default'
              })
          })
      })
  }
}
