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
        const res = await fetch('data/tree.json');
        treeData = await res.json();
      } catch (err) {
        console.error('Failed to load tree data:', err);
        alert('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
      }
    }

    // 全ポケモン名の抽出（オートコンプリート用）
    extractPokemonNames(treeData);
    populateDatalist();

    // イベントリスナーの登録
    bindEvents();
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
    const actual = inputActualPokemon.value.trim();
    if (!actual) return;

    const guessedName = resultPokemonName.textContent;
    sendLog('feedback_actual_pokemon', {
      guessed: guessedName,
      actual: actual,
      questions_count: historyStack.length,
    });

    formActualPokemon.style.display = 'none';
    feedbackSentMsg.style.display = 'block';
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
