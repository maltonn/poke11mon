/**
 * ポケモン 11 Questions - アプリケーションロジック
 */

(function () {
  'use strict';

  // --- 定数・設定 ---
  const LOG_ENDPOINT = 'https://rd.maltonn.com/log';
  const LOG_CATEGORY = '11question';

  // --- アプリ状態 ---
  let treeData = null;
  let currentNode = null;
  let historyStack = []; // [{ node, answer }]
  let allPokemonNames = [];
  let isAnimating = false;

  // --- DOM要素 ---
  const screens = {
    top: document.getElementById('screen-top'),
    quiz: document.getElementById('screen-quiz'),
    result: document.getElementById('screen-result'),
  };

  const btnStart = document.getElementById('btn-start');
  const btnYes = document.getElementById('btn-yes');
  const btnNo = document.getElementById('btn-no');
  const btnUndo = document.getElementById('btn-undo');

  // クイズ画面要素
  const quizStepNum = document.getElementById('quiz-step-num');
  const quizProgressBar = document.getElementById('quiz-progress-bar');
  const questionCard = document.getElementById('question-card');
  const cardCandidates = document.getElementById('card-candidates');
  const cardQuestionText = document.getElementById('card-question-text');

  // 結果画面要素
  const resultPokemonId = document.getElementById('result-pokemon-id');
  const resultPokemonName = document.getElementById('result-pokemon-name');
  const resultPokemonTypes = document.getElementById('result-pokemon-types');
  const resultZukanLink = document.getElementById('result-zukan-link');
  const feedbackInitial = document.getElementById('feedback-initial');
  const feedbackCorrectView = document.getElementById('feedback-correct-view');
  const feedbackWrongView = document.getElementById('feedback-wrong-view');
  const btnCorrect = document.getElementById('btn-correct');
  const btnWrong = document.getElementById('btn-wrong');
  const btnShare = document.getElementById('btn-share');
  const btnRestartSuccess = document.getElementById('btn-restart-from-success');
  const btnRestartWrong = document.getElementById('btn-restart-from-wrong');
  const formActualPokemon = document.getElementById('form-actual-pokemon');
  const inputActualPokemon = document.getElementById('input-actual-pokemon');
  const feedbackSentMsg = document.getElementById('feedback-sent-msg');
  const actualTreeContainer = document.getElementById('actual-tree-container');
  const pokemonListDatalist = document.getElementById('pokemon-list-datalist');
  const btnToggleHistory = document.getElementById('btn-toggle-history');
  const historyContent = document.getElementById('history-content');
  const historyList = document.getElementById('history-list');
  const historyCount = document.getElementById('history-count');

  // ==========================================
  // ログ送信ユーティリティ
  // ==========================================
  function sendLog(action, extraParams = {}) {
    try {
      const url = new URL(LOG_ENDPOINT);
      url.searchParams.set('c', LOG_CATEGORY);
      url.searchParams.set('value', action);

      for (const [key, val] of Object.entries(extraParams)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      }

      // ビーコンまたはfetch (no-cors) で送信
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url.toString());
      } else {
        fetch(url.toString(), { mode: 'no-cors', keepalive: true }).catch(() => { });
      }
    } catch (e) {
      // ログ送信の失敗はアプリの動作に影響させない
      console.warn('Log failed:', e);
    }
  }

  // ==========================================
  // 画面遷移
  // ==========================================
  function showScreen(screenKey) {
    Object.keys(screens).forEach((key) => {
      screens[key].classList.remove('active');
    });
    if (screens[screenKey]) {
      screens[screenKey].classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // ==========================================
  // 初期化・データロード
  // ==========================================
  async function init() {
    sendLog('page_view');

    // 決定木データのロード（window.TREE_DATA 優先、なければ fetch）
    if (window.TREE_DATA) {
      treeData = window.TREE_DATA;
    } else {
      try {
        const res = await fetch('data/tree.json?v=20261121_5');
        treeData = await res.json();
      } catch (err) {
        console.error('Failed to load tree data:', err);
        alert('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
      }
    }

    // フロントエンド用パッチ（お茶モチーフポケモン等の誤認を防ぐため「茶」を「茶色」に変更）
    patchTreeData(treeData);

    // 全ポケモン名の抽出（オートコンプリート用）
    extractPokemonNames(treeData);
    populateDatalist();

    // イベントリスナーの登録
    bindEvents();
  }

  function patchTreeData(node) {
    if (!node) return;
    if (node.question_text) {
      // お茶モチーフポケモン（ヤバチャ等）と混同しないよう「茶色」に変更
      node.question_text = node.question_text.replace(/「茶」ですか/g, '「茶色」ですか');
    }
    if (node.yes) patchTreeData(node.yes);
    if (node.no) patchTreeData(node.no);
  }

  function extractPokemonNames(node) {
    if (!node) return;
    if (node.type === 'leaf' && node.pokemon && node.pokemon.name_ja) {
      allPokemonNames.push(node.pokemon.name_ja);
      return;
    }
    if (node.yes) extractPokemonNames(node.yes);
    if (node.no) extractPokemonNames(node.no);
  }

  function populateDatalist() {
    const sorted = Array.from(new Set(allPokemonNames)).sort((a, b) => a.localeCompare(b, 'ja'));
    const fragment = document.createDocumentFragment();
    sorted.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      fragment.appendChild(opt);
    });
    pokemonListDatalist.appendChild(fragment);
  }

  // ==========================================
  // ゲーム進行
  // ==========================================
  function startGame() {
    sendLog('start_quiz');
    historyStack = [];
    currentNode = treeData;
    isAnimating = false;
    showScreen('quiz');
    renderQuestion(currentNode, true);
  }

  function renderQuestion(node, isFirst = false) {
    const stepNum = historyStack.length + 1;
    quizStepNum.textContent = stepNum;

    // 進捗率（最大11問）
    const pct = Math.min(100, Math.round((stepNum / 11) * 100));
    quizProgressBar.style.width = pct + '%';

    // カード内容更新
    cardCandidates.textContent = node.candidates_count ? `のこり約 ${node.candidates_count} 匹` : '';
    cardQuestionText.textContent = node.question_text || '';

    // 「戻る」ボタン活性状態
    btnUndo.disabled = historyStack.length === 0;

    // カードの出現アニメーション
    questionCard.className = 'question-card card-enter';
  }

  function handleAnswer(answer) {
    if (isAnimating || !currentNode) return;
    isAnimating = true;

    // 履歴に保存
    historyStack.push({
      node: currentNode,
      answer: answer,
    });

    // スワイプアニメーション: 「はい」なら左へ、「いいえ」なら右へ
    const swipeClass = answer === 'yes' ? 'swipe-left' : 'swipe-right';
    questionCard.className = `question-card ${swipeClass}`;

    setTimeout(() => {
      const nextNode = answer === 'yes' ? currentNode.yes : currentNode.no;
      currentNode = nextNode;

      if (!currentNode) {
        console.error('Node not found');
        isAnimating = false;
        return;
      }

      if (currentNode.type === 'leaf') {
        showResult(currentNode);
      } else {
        renderQuestion(currentNode);
      }
      isAnimating = false;
    }, 280);
  }

  function undoLastStep() {
    if (isAnimating || historyStack.length === 0) return;
    const last = historyStack.pop();
    currentNode = last.node;
    renderQuestion(currentNode);
  }

  // ==========================================
  // 結果画面
  // ==========================================
  function showResult(leafNode) {
    const pokemon = leafNode.pokemon || {};
    const name = pokemon.name_ja || '不明なポケモン';
    const pokeId = pokemon.id;

    sendLog('reach_result', {
      guessed_pokemon: name,
      depth: historyStack.length,
    });

    // UIリセット
    feedbackInitial.style.display = 'block';
    feedbackCorrectView.style.display = 'none';
    feedbackWrongView.style.display = 'none';
    feedbackSentMsg.style.display = 'none';
    if (actualTreeContainer) {
      actualTreeContainer.style.display = 'none';
      actualTreeContainer.innerHTML = '';
    }
    formActualPokemon.reset();
    formActualPokemon.style.display = 'flex';
    historyContent.style.display = 'none';
    btnToggleHistory.classList.remove('accordion-open');

    // ポケモン情報表示
    resultPokemonName.textContent = name;
    if (pokeId) {
      const paddedId = String(pokeId).padStart(4, '0');
      resultPokemonId.textContent = `No.${paddedId}`;
      resultPokemonId.style.display = 'inline-block';
      resultZukanLink.href = `https://zukan.pokemon.co.jp/detail/${paddedId}`;
      resultZukanLink.style.display = 'inline-flex';
    } else {
      resultPokemonId.style.display = 'none';
      resultZukanLink.style.display = 'none';
    }

    // タイプバッジ
    resultPokemonTypes.innerHTML = '';
    const types = [];
    if (pokemon.type1 && pokemon.type1 !== 'None') types.push(pokemon.type1);
    if (pokemon.type2 && pokemon.type2 !== 'None') types.push(pokemon.type2);

    types.forEach((type) => {
      const span = document.createElement('span');
      span.className = `type-pill type-${type}`;
      span.textContent = type;
      resultPokemonTypes.appendChild(span);
    });

    // 履歴リストの構築
    renderHistory();

    showScreen('result');
  }

  function renderHistory() {
    historyList.innerHTML = '';
    historyCount.textContent = historyStack.length;

    historyStack.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const isYes = item.answer === 'yes';
      const badge = document.createElement('span');
      badge.className = `history-badge ${isYes ? 'yes' : 'no'}`;
      badge.textContent = isYes ? 'はい' : 'いいえ';

      const text = document.createElement('span');
      text.className = 'history-q-text';
      text.textContent = `Q${index + 1}. ${item.node.question_text || ''}`;

      li.appendChild(badge);
      li.appendChild(text);
      historyList.appendChild(li);
    });
  }

  // ==========================================
  // フィードバック & シェア
  // ==========================================
  function handleCorrect() {
    const guessedName = resultPokemonName.textContent;
    sendLog('feedback_correct', {
      pokemon: guessedName,
      questions_count: historyStack.length,
    });

    feedbackInitial.style.display = 'none';
    feedbackCorrectView.style.display = 'block';
  }

  function handleWrong() {
    const guessedName = resultPokemonName.textContent;
    sendLog('feedback_wrong', {
      guessed_pokemon: guessedName,
      questions_count: historyStack.length,
    });

    feedbackInitial.style.display = 'none';
    feedbackWrongView.style.display = 'block';
  }

  function submitActualPokemon(e) {
    e.preventDefault();
    const rawActual = inputActualPokemon.value.trim();
    if (!rawActual) return;

    const guessedName = resultPokemonName.textContent;
    sendLog('feedback_actual_pokemon', {
      guessed: guessedName,
      actual: rawActual,
      questions_count: historyStack.length,
    });

    formActualPokemon.style.display = 'none';
    feedbackSentMsg.style.display = 'block';

    // 答え合わせ：質問ツリーを表示
    renderActualPokemonComparison(rawActual);
  }

  function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, (match) => {
      const chr = match.charCodeAt(0) + 0x60;
      return String.fromCharCode(chr);
    }).trim();
  }

  function findPathToPokemon(node, targetName, currentPath = []) {
    if (!node) return null;
    if (node.type === 'leaf') {
      if (node.pokemon && node.pokemon.name_ja === targetName) {
        return { path: currentPath, pokemon: node.pokemon };
      }
      return null;
    }

    if (node.yes) {
      const res = findPathToPokemon(node.yes, targetName, [
        ...currentPath,
        { node: node, expectedAnswer: 'yes' }
      ]);
      if (res) return res;
    }

    if (node.no) {
      const res = findPathToPokemon(node.no, targetName, [
        ...currentPath,
        { node: node, expectedAnswer: 'no' }
      ]);
      if (res) return res;
    }

    return null;
  }

  function renderActualPokemonComparison(rawInput) {
    if (!actualTreeContainer) return;
    actualTreeContainer.innerHTML = '';

    // 表記揺れ（カタカナ変換・部分一致探索）
    const normalized = toKatakana(rawInput);
    let matchedName = allPokemonNames.find((n) => n === normalized);
    if (!matchedName) {
      matchedName = allPokemonNames.find((n) => n.toLowerCase() === rawInput.toLowerCase());
    }
    if (!matchedName) {
      matchedName = allPokemonNames.find((n) => n.includes(normalized));
    }

    const targetName = matchedName || rawInput;
    const result = findPathToPokemon(treeData, targetName);

    if (!result) {
      actualTreeContainer.style.display = 'block';
      actualTreeContainer.innerHTML = `
        <div class="actual-tree-card">
          <div class="actual-tree-header">
            <h3 class="actual-tree-title">⚠️ 「${escapeHtml(rawInput)}」のデータが見つかりませんでした</h3>
            <p class="actual-tree-desc">名前が正しいか確認してください（全1,025匹のポケモンに対応しています）。</p>
          </div>
        </div>
      `;
      return;
    }

    const targetPokemon = result.pokemon;
    const path = result.path;

    // プレイヤーの履歴（historyStack）と比較
    let firstDivergeIndex = -1;
    let diverged = false;

    const stepComparisons = path.map((step, idx) => {
      let userStep = null;
      let status = 'unreached'; // match | diverge | unreached

      if (!diverged && idx < historyStack.length) {
        userStep = historyStack[idx];
        // ノードが一致している場合
        if (userStep.node && (userStep.node.node_id === step.node.node_id || userStep.node.question_text === step.node.question_text)) {
          if (userStep.answer === step.expectedAnswer) {
            status = 'match';
          } else {
            status = 'diverge';
            diverged = true;
            if (firstDivergeIndex === -1) {
              firstDivergeIndex = idx;
            }
          }
        } else {
          // ノードが一致しない場合はすでに分岐後
          diverged = true;
          if (firstDivergeIndex === -1) {
            firstDivergeIndex = idx;
          }
        }
      }

      return {
        stepIndex: idx + 1,
        node: step.node,
        expectedAnswer: step.expectedAnswer,
        userAnswer: userStep ? userStep.answer : null,
        status: status,
      };
    });

    // HTML構築
    const cardEl = document.createElement('div');
    cardEl.className = 'actual-tree-card';

    // ヘッダー部
    let noticeHtml = '';
    if (firstDivergeIndex !== -1) {
      noticeHtml = `
        <div class="actual-tree-diverge-notice">
          ⚡ <strong>Q${firstDivergeIndex + 1}</strong> で本来と異なる回答をしたため、別のポケモンへ分岐しました！
        </div>
      `;
    } else if (historyStack.length === path.length) {
      noticeHtml = `
        <div class="actual-tree-diverge-notice no-diverge">
          ✨ すべての質問の回答が一致していました！
        </div>
      `;
    }

    const headerHtml = `
      <div class="actual-tree-header">
        <h3 class="actual-tree-title">
          <span>🎯</span>
          <span>答え合わせ：「${escapeHtml(targetPokemon.name_ja)}」への道順</span>
        </h3>
        <p class="actual-tree-desc">
          「${escapeHtml(targetPokemon.name_ja)}」にたどり着くための本来の質問ルート（全${path.length}問）と、あなたの回答の比較です。
        </p>
        ${noticeHtml}
      </div>
    `;

    // ステップ一覧部
    let stepsHtml = '<div class="actual-tree-steps">';
    stepComparisons.forEach((item) => {
      const expYes = item.expectedAnswer === 'yes';
      const expBadge = `<span class="history-badge ${expYes ? 'yes' : 'no'}">${expYes ? 'はい' : 'いいえ'}</span>`;

      let statusTag = '';
      let userAnsHtml = '';
      let stepClass = 'actual-tree-step';

      if (item.status === 'match') {
        stepClass += ' step-match';
        statusTag = '<span class="step-status-tag tag-match">⭕ 一致</span>';
        const userYes = item.userAnswer === 'yes';
        userAnsHtml = `
          <div class="answer-item">
            <span class="answer-label">あなたの回答：</span>
            <span class="history-badge ${userYes ? 'yes' : 'no'}">${userYes ? 'はい' : 'いいえ'}</span>
          </div>
        `;
      } else if (item.status === 'diverge') {
        stepClass += ' step-diverge';
        statusTag = '<span class="step-status-tag tag-diverge">❌ ここで分岐！</span>';
        const userYes = item.userAnswer === 'yes';
        userAnsHtml = `
          <div class="answer-item">
            <span class="answer-label">あなたの回答：</span>
            <span class="history-badge ${userYes ? 'yes' : 'no'}">${userYes ? 'はい' : 'いいえ'}</span>
          </div>
        `;
      } else {
        stepClass += ' step-unreached';
        statusTag = '<span class="step-status-tag tag-unreached">正解ルート</span>';
        userAnsHtml = `
          <div class="answer-item">
            <span class="answer-label" style="opacity: 0.7;">（分岐後のため未出題）</span>
          </div>
        `;
      }

      const categoryBadge = item.node.category
        ? `<span class="step-category-badge">${escapeHtml(item.node.category)}</span>`
        : '';

      stepsHtml += `
        <div class="${stepClass}">
          <div class="step-meta-row">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="step-num-badge">Q${item.stepIndex}</span>
              ${categoryBadge}
            </div>
            ${statusTag}
          </div>
          <p class="step-question-text">${escapeHtml(item.node.question_text || '')}</p>
          <div class="step-answers-row">
            <div class="answer-item">
              <span class="answer-label">正解：</span>
              ${expBadge}
            </div>
            ${userAnsHtml}
          </div>
        </div>
      `;
    });
    stepsHtml += '</div>';

    // ゴール部
    const paddedId = targetPokemon.id ? String(targetPokemon.id).padStart(4, '0') : '';
    let typesHtml = '';
    if (targetPokemon.type1 && targetPokemon.type1 !== 'None') {
      typesHtml += `<span class="type-pill type-${targetPokemon.type1}">${targetPokemon.type1}</span>`;
    }
    if (targetPokemon.type2 && targetPokemon.type2 !== 'None') {
      typesHtml += `<span class="type-pill type-${targetPokemon.type2}">${targetPokemon.type2}</span>`;
    }

    const zukanLinkHtml = paddedId
      ? `<a href="https://zukan.pokemon.co.jp/detail/${paddedId}" target="_blank" rel="noopener noreferrer" class="btn-zukan-link" style="margin-top: 6px;">
           <span>📖 公式ポケモンずかんで見る ↗</span>
         </a>`
      : '';

    const goalHtml = `
      <div class="actual-tree-goal">
        <span class="goal-label">🏁 目指していたポケモン</span>
        ${paddedId ? `<span class="pokemon-id-badge">No.${paddedId}</span>` : ''}
        <h4 class="goal-pokemon-name">${escapeHtml(targetPokemon.name_ja)}</h4>
        <div class="pokemon-types" style="margin-bottom: 4px;">
          ${typesHtml}
        </div>
        ${zukanLinkHtml}
      </div>
    `;

    cardEl.innerHTML = headerHtml + stepsHtml + goalHtml;
    actualTreeContainer.appendChild(cardEl);
    actualTreeContainer.style.display = 'block';

    // スムーズスクロールで答え合わせツリーへ誘導
    actualTreeContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  function shareResult() {
    const guessedName = resultPokemonName.textContent;
    const count = historyStack.length;
    sendLog('click_share', { pokemon: guessedName, count: count });

    const shareText = `【ポケ11問！】\n私の思い浮かべたポケモンは「${guessedName}」でした！\n`;
    const shareUrl = 'https://maltonn.github.io/poke11mon';
    const hashtags = 'ポケ11問,ポケモン';

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}&hashtags=${encodeURIComponent(hashtags)}`;
    window.open(twitterUrl, '_blank', 'noopener,noreferrer');
  }

  // ==========================================
  // イベント登録
  // ==========================================
  function bindEvents() {
    btnStart.addEventListener('click', startGame);

    btnYes.addEventListener('click', () => handleAnswer('yes'));
    btnNo.addEventListener('click', () => handleAnswer('no'));
    btnUndo.addEventListener('click', undoLastStep);

    // キーボードショートカット（←: はい, →: いいえ, z: 戻る）
    window.addEventListener('keydown', (e) => {
      if (!screens.quiz.classList.contains('active')) return;
      if (e.key === 'ArrowLeft' || e.key === 'y' || e.key === 'Y') {
        handleAnswer('yes');
      } else if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        handleAnswer('no');
      } else if ((e.key === 'z' || e.key === 'Backspace') && !btnUndo.disabled) {
        undoLastStep();
      }
    });

    btnCorrect.addEventListener('click', handleCorrect);
    btnWrong.addEventListener('click', handleWrong);
    formActualPokemon.addEventListener('submit', submitActualPokemon);
    btnShare.addEventListener('click', shareResult);

    btnRestartSuccess.addEventListener('click', () => showScreen('top'));
    btnRestartWrong.addEventListener('click', () => showScreen('top'));

    btnToggleHistory.addEventListener('click', () => {
      const isHidden = historyContent.style.display === 'none';
      historyContent.style.display = isHidden ? 'block' : 'none';
      btnToggleHistory.classList.toggle('accordion-open', isHidden);
    });
  }

  // 起動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
