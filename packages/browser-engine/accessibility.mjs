// Accessibility Tree Snapshot Module
// 通过 CDP Accessibility.getFullAXTree 生成语义化页面快照
// 参考 vercel-labs/agent-browser 的 @eN 引用系统

export class AccessibilitySnapshot {
  constructor(cdp) {
    this.cdp = cdp;
    this._refCounter = 0;
    this._refMap = new Map(); // refId -> { backendNodeId, role, name, frameId, targetId }
  }

  // 重置引用计数器和映射
  resetRefs() {
    this._refCounter = 0;
    this._refMap.clear();
  }

  // 获取完整的无障碍树快照
  async getSnapshot(targetId, opts = {}) {
    this.resetRefs();
    const maxDepth = opts.maxDepth || 15;
    const includeIframes = opts.includeIframes !== false;

    await this.cdp.sendToTarget(targetId, 'Accessibility.enable', {});

    const result = await this.cdp.sendToTarget(targetId, 'Accessibility.getFullAXTree', {
      depth: maxDepth,
    });

    const nodes = result.result?.nodes || [];
    if (!nodes.length) return { snapshot: '', refs: {}, nodeCount: 0 };

    const lines = [];
    const refs = {};
    this._buildTree(nodes, lines, refs, targetId, 0);

    // 尝试内联 iframe 内容
    if (includeIframes) {
      await this._inlineIframes(targetId, lines, refs, maxDepth);
    }

    return {
      snapshot: lines.join('\n'),
      refs,
      nodeCount: nodes.length,
      refCount: Object.keys(refs).length,
    };
  }

  // 构建树形文本表示
  _buildTree(nodes, lines, refs, targetId, depth) {
    // 构建父子关系映射
    const childMap = new Map();
    const nodeMap = new Map();
    for (const node of nodes) {
      nodeMap.set(node.nodeId, node);
      const parentId = node.parentId;
      if (parentId) {
        if (!childMap.has(parentId)) childMap.set(parentId, []);
        childMap.get(parentId).push(node.nodeId);
      }
    }

    // 找到根节点
    const rootId = nodes[0]?.nodeId;
    if (!rootId) return;

    this._renderNode(rootId, nodeMap, childMap, lines, refs, targetId, 0);
  }

  _renderNode(nodeId, nodeMap, childMap, lines, refs, targetId, depth) {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const role = this._getProperty(node, 'role')?.value || node.role?.value || '';
    const name = this._getProperty(node, 'name')?.value || node.name?.value || '';
    const value = this._getProperty(node, 'value')?.value || '';
    const desc = this._getProperty(node, 'description')?.value || '';
    const focused = this._getBoolProperty(node, 'focused');
    const disabled = this._getBoolProperty(node, 'disabled');
    const checked = this._getProperty(node, 'checked')?.value;
    const expanded = this._getProperty(node, 'expanded')?.value;

    // 跳过无意义节点
    if (this._shouldSkip(role, name)) {
      // 但仍然遍历子节点
      const children = childMap.get(nodeId) || [];
      for (const cid of children) this._renderNode(cid, nodeMap, childMap, lines, refs, targetId, depth);
      return;
    }

    const indent = '  '.repeat(depth);
    const isInteractive = INTERACTIVE_ROLES.has(role);
    const isContent = CONTENT_ROLES.has(role);

    let refTag = '';
    if (isInteractive || isContent) {
      this._refCounter++;
      const refId = '@e' + this._refCounter;
      refTag = ' [' + refId + ']';
      refs[refId] = {
        backendNodeId: node.backendDOMNodeId || null,
        role, name, targetId,
      };
      this._refMap.set(refId, refs[refId]);
    }

    // 构建行
    let line = indent + role;
    if (name) line += ' "' + name.slice(0, 120) + '"';
    if (value) line += ' value="' + String(value).slice(0, 80) + '"';
    if (checked !== undefined) line += ' checked=' + checked;
    if (expanded !== undefined) line += ' expanded=' + expanded;
    if (disabled) line += ' disabled';
    if (focused) line += ' focused';
    if (desc) line += ' desc="' + desc.slice(0, 80) + '"';
    line += refTag;

    lines.push(line);

    // 递归子节点
    const children = childMap.get(nodeId) || [];
    for (const cid of children) {
      this._renderNode(cid, nodeMap, childMap, lines, refs, targetId, depth + 1);
    }
  }

  _getProperty(node, name) {
    return node.properties?.find(p => p.name === name)?.value;
  }

  _getBoolProperty(node, name) {
    const v = this._getProperty(node, name);
    return v?.value === true;
  }

  _shouldSkip(role, name) {
    if (!role) return true;
    if (SKIP_ROLES.has(role)) return true;
    if (role === 'generic' && !name) return true;
    if (role === 'none' || role === 'presentation') return true;
    return false;
  }

  // 内联 iframe 的无障碍树
  async _inlineIframes(targetId, lines, refs, maxDepth) {
    try {
      const tree = await this.cdp.sendToTarget(targetId, 'Page.getFrameTree', {});
      const frames = this._collectFrames(tree.result?.frameTree);
      for (const frame of frames) {
        if (frame.id === tree.result?.frameTree?.frame?.id) continue; // 跳过主框架
        try {
          const iframeResult = await this.cdp.sendToTarget(targetId, 'Accessibility.getFullAXTree', {
            depth: Math.min(maxDepth, 8),
            frameId: frame.id,
          });
          const iframeNodes = iframeResult.result?.nodes || [];
          if (iframeNodes.length > 0) {
            lines.push('  iframe "' + (frame.name || frame.url || 'anonymous') + '"');
            this._buildTree(iframeNodes, lines, refs, targetId, 2);
          }
        } catch { /* cross-origin iframe, skip */ }
      }
    } catch { /* no frame tree */ }
  }

  _collectFrames(frameTree) {
    const frames = [];
    if (!frameTree) return frames;
    if (frameTree.frame) frames.push(frameTree.frame);
    for (const child of (frameTree.childFrames || [])) {
      frames.push(...this._collectFrames(child));
    }
    return frames;
  }

  // 通过 @eN 引用解析元素坐标（双路径：快路径 backendNodeId + 回退语义查找）
  async resolveRef(targetId, refId) {
    const ref = this._refMap.get(refId);
    if (!ref) return { error: '引用不存在: ' + refId };

    // 快路径：使用 backendNodeId
    if (ref.backendNodeId) {
      try {
        await this.cdp.sendToTarget(targetId, 'DOM.enable', {});
        const box = await this.cdp.sendToTarget(targetId, 'DOM.getBoxModel', {
          backendNodeId: ref.backendNodeId,
        });
        if (box.result?.model) {
          const content = box.result.model.content;
          const x = (content[0] + content[2]) / 2;
          const y = (content[1] + content[5]) / 2;
          return { resolved: true, method: 'backendNodeId', x, y, ref };
        }
      } catch { /* node stale, fallback */ }
    }

    // 回退：通过 role + name 语义查找
    const js = `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      const role = ${JSON.stringify(ref.role)};
      const name = ${JSON.stringify(ref.name)};
      let node;
      while (node = walker.nextNode()) {
        const r = node.getAttribute('role') || node.tagName.toLowerCase();
        const n = node.getAttribute('aria-label') || node.textContent?.trim().slice(0, 120) || '';
        if (r.toLowerCase() === role.toLowerCase() || node.tagName.toLowerCase() === role.toLowerCase()) {
          if (!name || n.includes(name)) {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, tag: node.tagName };
            }
          }
        }
      }
      return null;
    })()`;
    const r = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: false,
    });
    const val = r.result?.result?.value;
    if (val) return { resolved: true, method: 'semantic', ...val, ref };
    return { error: '无法解析引用: ' + refId, ref };
  }

  // 通过 @eN 引用点击元素
  async clickRef(targetId, refId) {
    const resolved = await this.resolveRef(targetId, refId);
    if (resolved.error) return resolved;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: resolved.x, y: resolved.y, button: 'left', clickCount: 1,
    });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: resolved.x, y: resolved.y, button: 'left', clickCount: 1,
    });
    return { clicked: true, refId, ...resolved };
  }

  // Tab 关闭清理
  onTargetClosed(targetId) {
    // 清除该 target 的引用
    for (const [refId, ref] of this._refMap) {
      if (ref.targetId === targetId) this._refMap.delete(refId);
    }
  }

  // 重连重置
  resetState() {
    this.resetRefs();
  }
}

// 可交互角色 —— 分配 @eN 引用
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox',
  'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem',
]);

// 内容角色 —— 也分配引用（用于文本提取）
const CONTENT_ROLES = new Set([
  'heading', 'img', 'table', 'cell', 'row',
]);

// 跳过的角色（结构性，无语义）
const SKIP_ROLES = new Set([
  'LineBreak', 'InlineTextBox', 'StaticText',
]);

export default AccessibilitySnapshot;
