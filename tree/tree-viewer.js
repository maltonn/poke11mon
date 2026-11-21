/**
 * ポケ11問！ 全質問ツリービューア ロジック
 */

(function () {
  'use strict';

  // --- アプリケーション状態 ---
  let treeData = null;
  let allPokemonList = []; // [{ id, name_ja, type1, type2, depth, path }]
  let currentNode = null;
  let explorerPath = []; // ステップ探索の現在パス [{ node, answer }]

  // --- DOM要素 ---
  const statTotalPokemon = document.getElementById('stat-total-pokemon');
  const statMaxDepth = document.getElementById('stat-max-depth');
  const statAvgDepth = document.getElementById('stat-avg-depth');
  const statTotalNodes = document.getElementById('stat-total-nodes');

  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Tab 1: 検索
  const searchInput = document.getElementById('pokemon-search-input');
  const searchDatalist = document.getElementById('pokemon-search-datalist');
  const btnSearch = document.getElementById('btn-search-pokemon');
  const btnRandom = document.getElementById('btn-random-pokemon');
  const searchResultArea = document.getElementById('search-result-area');
  const quickPickContainer = document.getElementById('quick-pick-container');

  // Tab 2: 階層ツリー
  const treeContainer = document.getElementById('tree-hierarchy-container');
  const btnExpand1 = document.getElementById('btn-tree-depth-1');
  const btnExpand2 = document.getElementById('btn-tree-depth-2');
  const btnExpand3 = document.getElementById('btn-tree-depth-3');
  const btnExpandAll = document.getElementById('btn-tree-expand-all');
  const btnCollapseAll = document.getElementById('btn-tree-collapse-all');
  const treeFilterInput = document.getElementById('tree-filter-input');

  // Tab 3: ステップ探索
  const explorerBreadcrumbs = document.getElementById('explorer-breadcrumbs');
  const explorerCard = document.getElementById('explorer-card-area');
  const candidatesGrid = document.getElementById('candidates-grid');
  const candidatesCountBadge = document.getElementById('candidates-count-badge');

  // ==========================================
  // 初期化
  // ==========================================
  async function init() {
    // 決定木データのロード（window.TREE_DATA 優先、なければ fetch）
    if (window.TREE_DATA) {
      treeData = window.TREE_DATA;
    } else {
      try {
        const res = await fetch('../data/tree.json');
        treeData = await res.json();
      } catch (err) {
        console.error('Failed to load tree data:', err);
        alert('ツリーデータの読み込みに失敗しました。');
        return;
      }
    }

    // 全ポケモン情報の抽出と統計集計
    analyzeTree(treeData);

    // 統計バッジの更新
    renderStats();

    // 検索用 datalist の生成
    populateSearchDatalist();

    // クイックピック候補（有名ポケモン）
    renderQuickPickChips();

    // イベントバインド
    bindEvents();

    // デフォルトでピカチュウを検索表示
    showPokemonRoute('ピカチュウ');

    // 階層ツリーの初期描画（初期は2階層展開）
    renderTreeHierarchy(treeData, treeContainer);
    setHierarchyDepth(2);

    // ステップ探索の初期化
    initExplorer();
  }

  // ==========================================
  // ツリー分析 & 統計
  // ==========================================
  let totalLeafCount = 0;
  let totalQuestionNodes = 0;
  let maxDepth = 0;
  let depthSum = 0;

  function analyzeTree(node, depth = 0, currentPath = []) {
    if (!node) return;
    if (depth > maxDepth) maxDepth = depth;

    if (node.type === 'leaf') {
      totalLeafCount++;
      depthSum += depth;
      if (node.pokemon) {
        allPokemonList.push({
          ...node.pokemon,
          depth: depth,
          path: currentPath,
        });
      }
      return;
    }

    totalQuestionNodes++;
    if (node.yes) {
      analyzeTree(node.yes, depth + 1, [...currentPath, { node: node, answer: 'yes' }]);
    }
    if (node.no) {
      analyzeTree(node.no, depth + 1, [...currentPath, { node: node, answer: 'no' }]);
    }
  }

  function renderStats() {
    const avg = totalLeafCount > 0 ? (depthSum / totalLeafCount).toFixed(1) : 0;
    if (statTotalPokemon) statTotalPokemon.textContent = `${totalLeafCount} 匹`;
    if (statMaxDepth) statMaxDepth.textContent = `${maxDepth} 問`;
    if (statAvgDepth) statAvgDepth.textContent = `約 ${avg} 問`;
    if (statTotalNodes) statTotalNodes.textContent = `${totalQuestionNodes} 問`;
  }

  function populateSearchDatalist() {
    const sorted = [...allPokemonList].sort((a, b) => a.name_ja.localeCompare(b.name_ja, 'ja'));
    const fragment = document.createDocumentFragment();
    sorted.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.name_ja;
      opt.label = `No.${String(p.id).padStart(4, '0')} (${p.type1}${p.type2 && p.type2 !== 'None' ? '/' + p.type2 : ''})`;
      fragment.appendChild(opt);
    });
    searchDatalist.appendChild(fragment);
  }

  const FAMOUS_POKEMON = ['ピカチュウ', 'リザードン', 'ゲンガー', 'ミュウツー', 'イーブイ', 'ルカリオ', 'ゲッコウガ', 'ミミッキュ'];

  function renderQuickPickChips() {
    quickPickContainer.innerHTML = '';
    FAMOUS_POKEMON.forEach((name) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        searchInput.value = name;
        showPokemonRoute(name);
      });
      quickPickContainer.appendChild(btn);
    });
  }

  // ==========================================
  // Tab 1: 個別ポケモン検索 & ルート描画
  // ==========================================
  function showPokemonRoute(targetName) {
    const normalized = toKatakana(targetName.trim());
    let pokemon = allPokemonList.find((p) => p.name_ja === normalized);
    if (!pokemon) {
      pokemon = allPokemonList.find((p) => p.name_ja.includes(normalized));
    }

    if (!pokemon) {
      searchResultArea.innerHTML = `
        <div class="pokemon-route-result">
          <p style="color: #C53030; font-weight: 700;">「${escapeHtml(targetName)}」が見つかりませんでした。</p>
        </div>
      `;
      return;
    }

    const paddedId = String(pokemon.id).padStart(4, '0');
    let typesHtml = '';
    if (pokemon.type1 && pokemon.type1 !== 'None') {
      typesHtml += `<span class="type-pill type-${pokemon.type1}">${pokemon.type1}</span>`;
    }
    if (pokemon.type2 && pokemon.type2 !== 'None') {
      typesHtml += `<span class="type-pill type-${pokemon.type2}">${pokemon.type2}</span>`;
    }

    let stepsHtml = '<div class="route-step-list">';
    pokemon.path.forEach((step, idx) => {
      const isYes = step.answer === 'yes';
      const categoryBadge = step.node.category
        ? `<span class="step-category-badge">${escapeHtml(step.node.category)}</span>`
        : '';
      const candText = step.node.candidates_count
        ? `<span class="step-cand-badge">この時点の候補: 残り ${step.node.candidates_count}匹</span>`
        : '';

      stepsHtml += `
        <div class="route-step-item">
          <div class="step-header-line">
            <span class="step-num-badge">Q${idx + 1}</span>
            ${categoryBadge}
          </div>
          <div class="step-question-text">${escapeHtml(step.node.question_text)}</div>
          <div class="step-footer-line">
            <span class="step-answer-pill ${isYes ? 'yes' : 'no'}">
              <span>進む方向：</span>
              <strong>${isYes ? 'はい (Yes)' : 'いいえ (No)'}</strong>
            </span>
            ${candText}
          </div>
        </div>
      `;
    });
    stepsHtml += '</div>';

    searchResultArea.innerHTML = `
      <div class="pokemon-route-result">
        <div class="pokemon-hero-header">
          <div class="pokemon-hero-info">
            <span class="pokemon-hero-id">No.${paddedId}</span>
            <h3 class="pokemon-hero-name">${escapeHtml(pokemon.name_ja)}</h3>
            <div class="pokemon-types">${typesHtml}</div>
          </div>
          <div>
            <a href="https://zukan.pokemon.co.jp/detail/${paddedId}" target="_blank" rel="noopener noreferrer" class="btn-zukan-link">
              <span>📖 公式ポケモンずかん ↗</span>
            </a>
          </div>
        </div>
        <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 12px; font-weight: 700;">
          📍 ルート（全${pokemon.path.length}問の分岐）：
        </p>
        ${stepsHtml}
      </div>
    `;
  }

  function pickRandomPokemon() {
    if (allPokemonList.length === 0) return;
    const random = allPokemonList[Math.floor(Math.random() * allPokemonList.length)];
    searchInput.value = random.name_ja;
    showPokemonRoute(random.name_ja);
  }

  // ==========================================
  // Tab 2: 階層ツリー表示
  // ==========================================
  function renderTreeHierarchy(node, container, branchType = 'root') {
    if (!node) return;

    if (node.type === 'leaf') {
      const p = node.pokemon;
      const leafEl = document.createElement('div');
      leafEl.className = 'tree-leaf-item';
      const paddedId = p && p.id ? String(p.id).padStart(4, '0') : '';
      leafEl.innerHTML = `
        <span class="branch-type-tag ${branchType === 'yes' ? 'yes' : 'no'}">${branchType === 'yes' ? 'はい' : 'いいえ'}</span>
        <span class="leaf-id">No.${paddedId}</span>
        <span class="leaf-name">${escapeHtml(p ? p.name_ja : '不明')}</span>
        <span class="type-pill type-${p ? p.type1 : ''}">${p ? p.type1 : ''}</span>
      `;
      leafEl.addEventListener('click', () => {
        if (p && p.name_ja) {
          switchTab('tab-search');
          searchInput.value = p.name_ja;
          showPokemonRoute(p.name_ja);
        }
      });
      container.appendChild(leafEl);
      return;
    }

    const details = document.createElement('details');
    details.className = 'tree-node-details';
    details.dataset.depth = node.depth !== undefined ? node.depth : 0;

    const summary = document.createElement('summary');
    summary.className = 'tree-node-summary';

    let tagLabel = 'ルート';
    if (branchType === 'yes') tagLabel = 'はい';
    if (branchType === 'no') tagLabel = 'いいえ';

    summary.innerHTML = `
      <span class="branch-type-tag ${branchType}">${tagLabel}</span>
      <span class="node-text">Q${node.depth !== undefined ? node.depth + 1 : ''}. ${escapeHtml(node.question_text || '')}</span>
      <span class="node-count">${node.candidates_count ? node.candidates_count + '匹' : ''}</span>
    `;

    const branch = document.createElement('div');
    branch.className = 'tree-branch';

    if (node.yes) renderTreeHierarchy(node.yes, branch, 'yes');
    if (node.no) renderTreeHierarchy(node.no, branch, 'no');

    details.appendChild(summary);
    details.appendChild(branch);
    container.appendChild(details);
  }

  function setHierarchyDepth(maxOpenDepth) {
    const allDetails = treeContainer.querySelectorAll('.tree-node-details');
    allDetails.forEach((d) => {
      const depth = parseInt(d.dataset.depth, 10);
      d.open = depth < maxOpenDepth;
    });
  }

  function setAllHierarchyOpen(isOpen) {
    const allDetails = treeContainer.querySelectorAll('.tree-node-details');
    allDetails.forEach((d) => {
      d.open = isOpen;
    });
  }

  function filterTreeHierarchy(keyword) {
    keyword = keyword.trim().toLowerCase();
    const allSummaries = treeContainer.querySelectorAll('.tree-node-summary');
    allSummaries.forEach((s) => {
      const text = s.textContent.toLowerCase();
      const details = s.closest('details');
      if (!keyword) {
        s.style.backgroundColor = '';
        return;
      }
      if (text.includes(keyword)) {
        s.style.backgroundColor = '#FEFCBF';
        let parent = details;
        while (parent && parent.tagName === 'DETAILS') {
          parent.open = true;
          parent = parent.parentElement ? parent.parentElement.closest('details') : null;
        }
      } else {
        s.style.backgroundColor = '';
      }
    });
  }

  // ==========================================
  // Tab 3: ステップ探索 (Interactive Step Explorer)
  // ==========================================
  function initExplorer() {
    currentNode = treeData;
    explorerPath = [];
    renderExplorer();
  }

  function renderExplorer() {
    if (!currentNode) return;

    // パンくずリスト
    explorerBreadcrumbs.innerHTML = '';
    const rootBtn = document.createElement('button');
    rootBtn.className = 'crumb-btn';
    rootBtn.textContent = 'ルート (Start)';
    rootBtn.addEventListener('click', () => {
      currentNode = treeData;
      explorerPath = [];
      renderExplorer();
    });
    explorerBreadcrumbs.appendChild(rootBtn);

    explorerPath.forEach((step, idx) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '>';
      explorerBreadcrumbs.appendChild(sep);

      const btn = document.createElement('button');
      btn.className = 'crumb-btn';
      btn.textContent = `Q${idx + 1} (${step.answer === 'yes' ? 'はい' : 'いいえ'})`;
      btn.addEventListener('click', () => {
        currentNode = step.targetNode;
        explorerPath = explorerPath.slice(0, idx + 1);
        renderExplorer();
      });
      explorerBreadcrumbs.appendChild(btn);
    });

    // メインカード
    if (currentNode.type === 'leaf') {
      const p = currentNode.pokemon || {};
      const paddedId = p.id ? String(p.id).padStart(4, '0') : '';
      explorerCard.innerHTML = `
        <div class="current-node-box">
          <span class="current-q-badge" style="background: #E6FFFA; color: #234E52;">🎉 到達！</span>
          <div style="margin: 12px 0;">
            <span style="font-size: 0.9rem; font-weight: 900; color: var(--text-muted);">No.${paddedId}</span>
            <h2 style="font-size: 2rem; font-weight: 900; color: var(--text-main); margin: 4px 0 10px;">${escapeHtml(p.name_ja)}</h2>
            <div class="pokemon-types" style="justify-content: center; margin-bottom: 12px;">
              <span class="type-pill type-${p.type1}">${p.type1}</span>
              ${p.type2 && p.type2 !== 'None' ? `<span class="type-pill type-${p.type2}">${p.type2}</span>` : ''}
            </div>
            <a href="https://zukan.pokemon.co.jp/detail/${paddedId}" target="_blank" rel="noopener noreferrer" class="btn-zukan-link">
              <span>📖 公式ポケモンずかんで見る ↗</span>
            </a>
          </div>
          <div class="explorer-nav-row" style="margin-top: 16px;">
            <button id="btn-exp-back" class="btn btn-subtle btn-sm">↩ 1つ前に戻る</button>
            <button id="btn-exp-reset" class="btn btn-primary btn-sm">最初からやり直す</button>
          </div>
        </div>
      `;
      document.getElementById('btn-exp-back').addEventListener('click', stepBackExplorer);
      document.getElementById('btn-exp-reset').addEventListener('click', initExplorer);
      renderCandidatesUnderNode(currentNode);
      return;
    }

    const stepNum = explorerPath.length + 1;
    const catBadge = currentNode.category
      ? `<span class="step-category-badge" style="margin-left: 6px;">${escapeHtml(currentNode.category)}</span>`
      : '';

    explorerCard.innerHTML = `
      <div class="current-node-box">
        <div style="margin-bottom: 8px;">
          <span class="current-q-badge">第 ${stepNum} 問</span>
          ${catBadge}
          <span class="candidates-badge" style="margin-left: 6px;">残り ${currentNode.candidates_count} 匹</span>
        </div>
        <h3 class="current-q-text">${escapeHtml(currentNode.question_text)}</h3>
        <div class="explorer-actions">
          <button id="btn-exp-yes" class="btn btn-step-yes">
            <span>⭕ はい</span>
          </button>
          <button id="btn-exp-no" class="btn btn-step-no">
            <span>❌ いいえ</span>
          </button>
        </div>
        <div class="explorer-nav-row">
          <button id="btn-exp-back" class="btn btn-subtle btn-sm" ${explorerPath.length === 0 ? 'disabled' : ''}>
            ↩ 1つ前に戻る
          </button>
          <button id="btn-exp-reset" class="btn btn-subtle btn-sm" ${explorerPath.length === 0 ? 'disabled' : ''}>
            最初に戻る
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-exp-yes').addEventListener('click', () => chooseExplorerStep('yes'));
    document.getElementById('btn-exp-no').addEventListener('click', () => chooseExplorerStep('no'));
    document.getElementById('btn-exp-back').addEventListener('click', stepBackExplorer);
    document.getElementById('btn-exp-reset').addEventListener('click', initExplorer);

    // 配下の候補ポケモン一覧の描画
    renderCandidatesUnderNode(currentNode);
  }

  function chooseExplorerStep(answer) {
    if (!currentNode) return;
    const nextNode = answer === 'yes' ? currentNode.yes : currentNode.no;
    if (!nextNode) return;

    explorerPath.push({
      parentNode: currentNode,
      targetNode: nextNode,
      answer: answer,
    });
    currentNode = nextNode;
    renderExplorer();
  }

  function stepBackExplorer() {
    if (explorerPath.length === 0) return;
    explorerPath.pop();
    if (explorerPath.length === 0) {
      currentNode = treeData;
    } else {
      currentNode = explorerPath[explorerPath.length - 1].targetNode;
    }
    renderExplorer();
  }

  function getLeavesUnderNode(node, list = []) {
    if (!node) return list;
    if (node.type === 'leaf' && node.pokemon) {
      list.push(node.pokemon);
      return list;
    }
    if (node.yes) getLeavesUnderNode(node.yes, list);
    if (node.no) getLeavesUnderNode(node.no, list);
    return list;
  }

  function renderCandidatesUnderNode(node) {
    const list = getLeavesUnderNode(node);
    candidatesCountBadge.textContent = `${list.length} 匹`;
    candidatesGrid.innerHTML = '';

    const fragment = document.createDocumentFragment();
    list.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'cand-item-card';
      const paddedId = p.id ? String(p.id).padStart(4, '0') : '';
      card.innerHTML = `
        <span class="cand-item-id">No.${paddedId}</span>
        <span class="cand-item-name">${escapeHtml(p.name_ja)}</span>
        <div class="pokemon-types">
          <span class="type-pill type-${p.type1}">${p.type1}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        switchTab('tab-search');
        searchInput.value = p.name_ja;
        showPokemonRoute(p.name_ja);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      fragment.appendChild(card);
    });
    candidatesGrid.appendChild(fragment);
  }

  // ==========================================
  // タブ切り替え
  // ==========================================
  function switchTab(targetTabId) {
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === targetTabId);
    });
    tabContents.forEach((content) => {
      content.classList.toggle('active', content.id === targetTabId);
    });
  }

  // ==========================================
  // イベントバインド
  // ==========================================
  function bindEvents() {
    // タブ切り替え
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // Tab 1
    btnSearch.addEventListener('click', () => {
      const val = searchInput.value.trim();
      if (val) showPokemonRoute(val);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = searchInput.value.trim();
        if (val) showPokemonRoute(val);
      }
    });
    btnRandom.addEventListener('click', pickRandomPokemon);

    // Tab 2
    btnExpand1.addEventListener('click', () => setHierarchyDepth(1));
    btnExpand2.addEventListener('click', () => setHierarchyDepth(2));
    btnExpand3.addEventListener('click', () => setHierarchyDepth(3));
    btnExpandAll.addEventListener('click', () => setAllHierarchyOpen(true));
    btnCollapseAll.addEventListener('click', () => setAllHierarchyOpen(false));

    treeFilterInput.addEventListener('input', (e) => {
      filterTreeHierarchy(e.target.value);
    });
  }

  // ユーティリティ
  function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, (match) => {
      const chr = match.charCodeAt(0) + 0x60;
      return String.fromCharCode(chr);
    }).trim();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 起動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
