(function initMistakery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MistakeryEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createEngine() {
  const RESOURCE_KEYS = ['cash', 'team', 'customers', 'founder'];

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cardById(deck, id) {
    return deck.cards.find((card) => card.id === id) || null;
  }

  function validateDeck(deck) {
    const errors = [];
    if (!deck || !deck.meta || !Array.isArray(deck.cards)) return ['Deck requires meta and cards.'];
    const ids = new Set();
    deck.cards.forEach((card) => {
      if (!card.id) errors.push('Card without id.');
      if (ids.has(card.id)) errors.push(`Duplicate card id: ${card.id}`);
      ids.add(card.id);
      if (!card.source || !deck.sources[card.source]) errors.push(`Unknown source on ${card.id}.`);
      if (!card.choices || !card.choices.left || !card.choices.right) errors.push(`Card ${card.id} requires two choices.`);
    });
    deck.cards.forEach((card) => {
      ['left', 'right'].forEach((side) => {
        const choice = card.choices && card.choices[side];
        asArray(choice && choice.next).forEach((id) => {
          if (!ids.has(id)) errors.push(`Card ${card.id} points to missing ${id}.`);
        });
        if (choice && choice.delay && !ids.has(choice.delay.card)) errors.push(`Card ${card.id} delays missing ${choice.delay.card}.`);
        if (choice && choice.delay && ids.has(choice.delay.card)) {
          const target = deck.cards.find((item) => item.id === choice.delay.card);
          if (!target || target.callbackOnly !== true || target.kind !== 'sideStory') {
            errors.push(`Card ${card.id} delays ${choice.delay.card} which is not a callbackOnly sideStory callback.`);
          }
        }
        if (choice && choice.reserveCallback && !ids.has(choice.reserveCallback.callbackId)) {
          errors.push(`Card ${card.id} reserves missing ${choice.reserveCallback.callbackId}.`);
        }
        if (choice && choice.crisis && !deck.crises?.[choice.crisis]) errors.push(`Card ${card.id} forces missing crisis ${choice.crisis}.`);
      });
    });
    if (!ids.has(deck.meta.startCard)) errors.push(`Missing start card: ${deck.meta.startCard}`);
    return errors;
  }

  function initialResources(deck) {
    return RESOURCE_KEYS.reduce((all, key) => {
      all[key] = Number(deck.resources[key].initial);
      return all;
    }, {});
  }

  function startRun(deck, options = {}) {
    const errors = validateDeck(deck);
    if (errors.length) throw new Error(errors.join('\n'));
    const resources = initialResources(deck);
    return {
      turn: 1,
      resources,
      schedulerResources: { ...resources },
      flags: [],
      shown: [],
      delayed: [],
      reservations: [],
      schedulerLocks: [],
      currentCardId: deck.meta.startCard,
      activeArc: null,
      queuedCardId: null,
      queuedCardIds: [],
      queuedPool: false,
      queuedPoolMode: null,
      queuedBoundary: null,
      pendingContinuation: null,
      pressureCount: 0,
      activeCrisisId: null,
      postCrisisOutcome: null,
      rescueAttempts: 0,
      gameOver: false,
      win: false,
      endingId: null,
      history: [],
      fillerCards: [],
      seed: options.seed || null,
    };
  }

  function cloneState(state) {
    return {
      ...state,
      resources: { ...state.resources },
      schedulerResources: { ...(state.schedulerResources || state.resources) },
      flags: [...state.flags],
      shown: [...state.shown],
      delayed: state.delayed.map((entry) => ({ ...entry })),
      reservations: (state.reservations || []).map((entry) => ({ ...entry })),
      schedulerLocks: [...(state.schedulerLocks || [])],
      queuedCardIds: [...(state.queuedCardIds || [])],
      queuedBoundary: state.queuedBoundary ? { ...state.queuedBoundary } : null,
      pendingContinuation: state.pendingContinuation
        ? { ...state.pendingContinuation, ids: [...state.pendingContinuation.ids] }
        : null,
      postCrisisOutcome: state.postCrisisOutcome ? { ...state.postCrisisOutcome } : null,
      history: state.history.map((entry) => ({ ...entry, deltas: { ...entry.deltas } })),
      fillerCards: [...(state.fillerCards || [])],
    };
  }

  function getChoiceLabel(choice, founder) {
    if (founder <= 25 && choice.lowLabel) return choice.lowLabel;
    if (founder >= 85 && choice.highLabel) return choice.highLabel;
    return choice.label;
  }

  function getAffectedResources(choice) {
    return RESOURCE_KEYS.filter((key) => Number(choice.effects && choice.effects[key] || 0) !== 0);
  }

  function triggerMatches(card, state) {
    const trigger = card.trigger || {};
    if (trigger.minTurn && state.turn < trigger.minTurn) return false;
    if (trigger.maxTurn && state.turn > trigger.maxTurn) return false;
    if (asArray(trigger.all).some((flag) => !state.flags.includes(flag))) return false;
    if (asArray(trigger.none).some((flag) => state.flags.includes(flag))) return false;
    if (asArray(trigger.any).length && !asArray(trigger.any).some((flag) => state.flags.includes(flag))) return false;
    return true;
  }

  function continuationMode(card) {
    if (card && card.continuation) return card.continuation;
    if (card && card.kind === 'pressure') return 'ambient';
    if (card && card.opensPressureSlot === true) return 'weighted';
    return 'forced';
  }

  function resourceRangeMatches(card, state) {
    const resources = schedulerRole(card) && state.schedulerResources
      ? state.schedulerResources
      : state.resources;
    return Object.entries(card.resourceRange || {}).every(([resource, range]) => {
      if (!RESOURCE_KEYS.includes(resource) || !range) return false;
      const value = Number(resources[resource]);
      const min = range.min == null ? null : Number(range.min);
      const max = range.max == null ? null : Number(range.max);
      if (!Number.isFinite(value)) return false;
      if (min != null && (!Number.isFinite(min) || value < min)) return false;
      if (max != null && (!Number.isFinite(max) || value > max)) return false;
      return true;
    });
  }

  function schedulerConfig(deck) {
    return deck && deck.meta && deck.meta.scheduler ? deck.meta.scheduler : null;
  }

  function schedulerRole(card) {
    return card && card.scheduler ? card.scheduler.role : null;
  }

  function schedulerIsLocked(deck, state) {
    const config = schedulerConfig(deck);
    if (!config) return false;
    return (config.locks || []).some((lock) =>
      (state.schedulerLocks || []).includes(lock.lockCardId));
  }

  function boundaryFor(deck, before, after) {
    const config = schedulerConfig(deck);
    if (!config) return null;
    return (config.boundaries || []).find((boundary) => boundary.before === before && boundary.after === after) || null;
  }

  function reservationForBoundary(deck, state, boundary) {
    if (!boundary) return null;
    return (state.reservations || []).find((reservation) => {
      if (reservation.callbackSlot !== boundary.id || Number(reservation.remainingSpineSteps || 0) > 0) return false;
      const callback = cardById(deck, reservation.callbackId);
      return callback && schedulerRole(callback) === 'callback' && cardIsEligible(deck, callback, state);
    }) || null;
  }

  function buildBoundaryPool(deck, state, boundaryId) {
    const config = schedulerConfig(deck);
    const boundary = config && (config.boundaries || []).find((item) => item.id === boundaryId);
    if (!boundary || schedulerIsLocked(deck, state)) return [];
    const allowedRoles = new Set(asArray(boundary.roles));
    if (allowedRoles.has('callback')) {
      const reservation = reservationForBoundary(deck, state, boundary);
      if (reservation) return [{ card: cardById(deck, reservation.callbackId), weight: 1, reservation }];
    }
    if ((state.reservations || []).length) return [];
    return buildEligiblePool(deck, state, { includeScheduled: true }).filter((entry) => {
      const role = schedulerRole(entry.card);
      return role !== 'callback' && allowedRoles.has(role) && entry.card.scheduler.slot === boundary.id;
    });
  }

  function scheduleVariableAtBoundary(deck, state, boundary, after, rng, onSchedulerBoundary) {
    if (!boundary || schedulerIsLocked(deck, state)) return false;
    const pool = buildBoundaryPool(deck, state, boundary.id);
    if (typeof onSchedulerBoundary === 'function') {
      onSchedulerBoundary({
        boundary: { ...boundary },
        state: cloneState(state),
        pool: pool.map((entry) => ({ cardId: entry.card.id, role: schedulerRole(entry.card), moduleId: entry.card.scheduler?.moduleId || null })),
      });
    }
    const reservation = pool[0] && pool[0].reservation;
    const selected = weightedPoolPick(pool, rng);
    if (!selected) return false;

    if (reservation) {
      state.reservations = state.reservations.filter((entry) => entry !== reservation);
    }
    state.queuedCardId = after;
    state.queuedCardIds = [after];
    state.queuedBoundary = { id: boundary.id, before: boundary.before, after };
    state.currentCardId = selected.id;
    return true;
  }

  function activateSchedulerLock(deck, state, card, choice) {
    const config = schedulerConfig(deck);
    if (!config || choice.switchArc) return;
    (config.locks || []).forEach((lock) => {
      if (lock.forbidVariableSlots && card.id === lock.lockCardId && state.activeArc === lock.arc
        && !state.schedulerLocks.includes(lock.lockCardId)) {
        state.schedulerLocks.push(lock.lockCardId);
      }
    });
  }

  function cardIsEligible(deck, card, state) {
    if (!card || !triggerMatches(card, state)) return false;
    if (asArray(card.activeArcs).length && !asArray(card.activeArcs).includes(state.activeArc)) return false;
    if (card.excludesPendingCallbacks === true && state.delayed.length) return false;
    if (asArray(card.requires).some((flag) => !state.flags.includes(flag))) return false;
    if (asArray(card.excludes).some((flag) => state.flags.includes(flag))) return false;
    if (!resourceRangeMatches(card, state)) return false;
    if (schedulerIsLocked(deck, state) && schedulerRole(card)) return false;
    if (schedulerRole(card) === 'seed' && (state.reservations || []).length) return false;
    const oncePerRun = card.oncePerRun === true
      || (card.oncePerRun == null && card.kind === 'pressure');
    if (oncePerRun && state.shown.includes(card.id)) return false;
    return true;
  }

  function lastResolvedCard(deck, state) {
    const lastHistory = state.history[state.history.length - 1];
    return cardById(deck, lastHistory ? lastHistory.cardId : state.currentCardId);
  }

  function buildEligiblePool(deck, state, options = {}) {
    const ids = options.ids ? new Set(asArray(options.ids)) : null;
    const modes = options.modes ? new Set(asArray(options.modes)) : null;
    const previousWasAmbient = continuationMode(lastResolvedCard(deck, state)) === 'ambient';
    const activeArcMultiplier = Number(deck.meta.activeArcWeightMultiplier || 3);

    return deck.cards
      .filter((card) => !ids || ids.has(card.id))
      .filter((card) => !modes || modes.has(continuationMode(card)))
      .filter((card) => options.includeScheduled === true || !schedulerRole(card))
      .filter((card) => cardIsEligible(deck, card, state))
      .filter((card) => options.allowConsecutiveAmbient === true
        || !(previousWasAmbient && continuationMode(card) === 'ambient'))
      .map((card) => ({
        card,
        weight: Number(card.weight || 1)
          * (state.activeArc && card.arc === state.activeArc ? activeArcMultiplier : 1),
      }));
  }

  function weightedPoolPick(pool, rng) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return null;
    let target = rng() * total;
    for (const entry of pool) {
      target -= entry.weight;
      if (target <= 0) return entry.card;
    }
    return pool[pool.length - 1]?.card || null;
  }

  function takeDueCallback(deck, state) {
    const dueIndex = state.delayed.findIndex((entry) => {
      const card = cardById(deck, entry.card);
      const isDue = entry.remainingStoryDecisions != null
        ? entry.remainingStoryDecisions <= 0
        : entry.dueAfter <= state.history.length;
      return isDue
        && card
        && cardIsEligible(deck, card, state);
    });
    if (dueIndex >= 0) {
      const [entry] = state.delayed.splice(dueIndex, 1);
      return cardById(deck, entry.card);
    }
    return null;
  }

  function takeEarliestPendingCallback(deck, state) {
    // Force-delivery only ever handles typed callbacks (callbackOnly side-story),
    // never a pressure or ordinary story card slipped in by a mistaken delay.
    const idx = (state.delayed || []).findIndex((entry) => {
      const card = cardById(deck, entry.card);
      return card && card.callbackOnly === true && card.kind === 'sideStory'
        && cardIsEligible(deck, card, state);
    });
    if (idx < 0) return null;
    const [entry] = state.delayed.splice(idx, 1);
    return cardById(deck, entry.card);
  }

  function pickPressureCard(deck, state, rng) {
    if (schedulerIsLocked(deck, state)) return null;
    const dueCallback = takeDueCallback(deck, state);
    if (dueCallback) return dueCallback;

    const pressureSlotsLeft = Number(deck.meta.maxPressureCards || 4) - state.pressureCount;
    const hasScheduledCallback = state.delayed.some((entry) => {
      const card = cardById(deck, entry.card);
      return card?.kind === 'pressure' && !state.shown.includes(entry.card);
    });
    if (hasScheduledCallback && pressureSlotsLeft === 1) return null;

    const eligible = buildEligiblePool(deck, state, { modes: ['ambient'] })
      .filter((entry) => entry.card.kind === 'pressure' && entry.card.callbackOnly !== true);
    return weightedPoolPick(eligible, rng);
  }

  function selectNextCard(deck, state, options = {}) {
    if (state.queuedCardId) return cardById(deck, state.queuedCardId);
    const rng = options.rng || Math.random;
    const mode = options.mode || 'ambient';
    const ids = asArray(options.ids);
    if (mode === 'forced') return cardById(deck, ids[0]) || null;
    const pool = buildEligiblePool(deck, state, {
      ids: ids.length ? ids : undefined,
      modes: options.modes || (mode === 'ambient' ? ['ambient'] : undefined),
    });
    return weightedPoolPick(pool, rng);
  }

  function applyFlags(state, choice) {
    asArray(choice.setFlags).forEach((flag) => {
      if (!state.flags.includes(flag)) state.flags.push(flag);
    });
    asArray(choice.clearFlags).forEach((flag) => {
      state.flags = state.flags.filter((item) => item !== flag);
    });
  }

  function advanceStoryDelays(state, card) {
    if (card.kind !== 'story' && card.schedulerSpineStep !== true) return;
    state.delayed.forEach((entry) => {
      if (entry.remainingStoryDecisions != null && entry.remainingStoryDecisions > 0) {
        entry.remainingStoryDecisions -= 1;
      }
    });
    (state.reservations || []).forEach((entry) => {
      if (entry.remainingSpineSteps > 0) entry.remainingSpineSteps -= 1;
    });
  }

  function stateEffectMatches(effect, state) {
    return asArray(effect.requires).every((flag) => state.flags.includes(flag))
      && asArray(effect.excludes).every((flag) => !state.flags.includes(flag));
  }

  function applyEffects(deck, state, card, choice) {
    const before = { ...state.resources };
    const stateEffects = asArray(card.stateEffects).filter((effect) => stateEffectMatches(effect, state));
    RESOURCE_KEYS.forEach((key) => {
      const base = key === 'cash' ? Number(deck.meta.baseCashBurn || 0) : 0;
      const effect = Number(choice.effects && choice.effects[key] || 0);
      const remembered = stateEffects.reduce((sum, item) => sum + Number(item.effects && item.effects[key] || 0), 0);
      const config = deck.resources[key];
      state.resources[key] = clamp(state.resources[key] + base + effect + remembered, config.min, config.max);
      if (!schedulerRole(card)) {
        state.schedulerResources[key] = clamp(
          state.schedulerResources[key] + base + effect,
          config.min,
          config.max,
        );
      }
    });
    return RESOURCE_KEYS.reduce((all, key) => {
      all[key] = state.resources[key] - before[key];
      return all;
    }, {});
  }

  function findBoundary(deck, state) {
    for (const key of RESOURCE_KEYS) {
      const config = deck.resources[key];
      if (state.resources[key] <= config.min && deck.crises[`${key}_low`]) return `${key}_low`;
      if (state.resources[key] >= config.max && deck.crises[`${key}_high`]) return `${key}_high`;
    }
    return null;
  }

  function insideCorridor(deck, state) {
    return RESOURCE_KEYS.every((key) => {
      const config = deck.resources[key];
      return state.resources[key] > config.min && state.resources[key] < config.max;
    });
  }

  function pickNextId(next, rng) {
    const ids = asArray(next);
    if (!ids.length) return null;
    return ids[Math.floor(rng() * ids.length)] || ids[0];
  }

  function shouldOpenPressureSlot(deck, card, state) {
    if (state.pressureCount >= Number(deck.meta.maxPressureCards || 4)) return false;
    if (card.opensPressureSlot === true) return true;
    return card.kind === 'story'
      && Number.isFinite(Number(card.arcStep))
      && asArray(deck.meta.pressureAfterArcSteps || [1, 3, 5]).includes(Number(card.arcStep));
  }

  function finishOutcome(state, outcome) {
    state.gameOver = true;
    state.win = Boolean(outcome.win);
    state.endingId = outcome.endingId;
    state.postCrisisOutcome = null;
    state.pendingContinuation = null;
    state.queuedCardId = null;
    state.queuedCardIds = [];
    state.queuedBoundary = null;
    state.delayed = [];
    state.reservations = [];
  }

  function endWithoutProof(state) {
    state.gameOver = true;
    state.endingId = 'no_proof';
    state.pendingContinuation = null;
    state.queuedCardId = null;
    state.queuedCardIds = [];
    state.queuedBoundary = null;
    state.delayed = [];
    state.reservations = [];
  }

  function eligibleFallbackPool(deck, state) {
    if (!deck.meta.fallbackCard) return [];
    return buildEligiblePool(deck, state, { ids: [deck.meta.fallbackCard] });
  }

  function eligibleStoryPool(deck, state, ids) {
    const pool = buildEligiblePool(deck, state, { ids });
    return pool.length ? pool : eligibleFallbackPool(deck, state);
  }

  function eligibleArcBeatPool(deck, state) {
    return buildEligiblePool(deck, state)
      .filter((entry) => entry.card.arcBeat === true && entry.card.arc === state.activeArc);
  }

  // The general storylet pool: every eligible entry point in the deck, with no
  // arc scoping. This is what lets a story be picked without an arc having been
  // entered by a hard-coded arrow — the difference between a deck and a rail.
  function eligibleStoryletPool(deck, state) {
    return buildEligiblePool(deck, state)
      .filter((entry) => entry.card.storyletEntry === true);
  }

  // When a pool-like continuation has no eligible story left (the storylet was
  // declined or exhausted), the run keeps living on background cards until
  // maxTurns instead of ending on the spot. Fillers bypass the pressure budget
  // and the no-two-ambient rule: there is no story pacing left to protect,
  // only the tail of the run to fill.
  function pickBackgroundFiller(deck, state, rng) {
    const pool = buildEligiblePool(deck, state, { modes: ['ambient', 'sideStory'], allowConsecutiveAmbient: true })
      .filter((entry) => entry.card.callbackOnly !== true);
    return weightedPoolPick(pool, rng);
  }

  function poolForMode(deck, state, transition, nextIds) {
    if (transition.mode === 'pool') return eligibleArcBeatPool(deck, state);
    if (transition.mode === 'storylet') return eligibleStoryletPool(deck, state);
    return eligibleStoryPool(deck, state, nextIds);
  }

  // Both pool-like modes rebuild their pool from live state on resume, so the
  // interrupting card's own flags are seen. Remember which one to rebuild.
  function markQueuedPool(state, mode) {
    if (mode !== 'pool' && mode !== 'storylet') return;
    state.queuedPool = true;
    state.queuedPoolMode = mode;
  }

  function isPoolLikeMode(mode) {
    return mode === 'pool' || mode === 'storylet';
  }

  function transitionFor(card, openPressureSlot) {
    if (card.continuation === 'forced' || card.continuation === 'weighted'
      || card.continuation === 'pool' || card.continuation === 'storylet') {
      return { mode: card.continuation };
    }
    return { mode: openPressureSlot ? 'legacy' : 'forced' };
  }

  function sideStoryCanInsert(card, storyPool) {
    const permitted = asArray(card.insertionBefore);
    return !permitted.length || storyPool.some((entry) => permitted.includes(entry.card.id));
  }

  function queueOrContinue(deck, state, next, transition, rng, onSchedulerBoundary) {
    const nextIds = asArray(next);
    if (!transition.skipScheduler && nextIds.length === 1) {
      const boundary = boundaryFor(deck, transition.beforeId, nextIds[0]);
      if (boundary) {
        if (scheduleVariableAtBoundary(deck, state, boundary, nextIds[0], rng, onSchedulerBoundary)) return;
        const continuation = cardById(deck, nextIds[0]);
        if (continuation && cardIsEligible(deck, continuation, state)) {
          state.currentCardId = continuation.id;
          return;
        }
        const fallback = eligibleFallbackPool(deck, state)[0]?.card;
        if (fallback) {
          state.currentCardId = fallback.id;
          return;
        }
        endWithoutProof(state);
        return;
      }
    }
    if (transition.mode === 'forced') {
      const forcedId = pickNextId(nextIds, rng);
      if (forcedId) {
        state.currentCardId = forcedId;
        return;
      }
      const fallback = eligibleFallbackPool(deck, state)[0]?.card;
      if (fallback) {
        state.currentCardId = fallback.id;
        return;
      }
      endWithoutProof(state);
      return;
    }

    if (transition.mode === 'resume') {
      if (transition.pool) {
        // Pool-origin resume rebuilds the arc pool from current flags/resources
        // (Codex F3) instead of a stale id snapshot, so a beat unlocked by the
        // inserted card is seen and a completed one is dropped.
        const rebuilt = transition.poolMode === 'storylet'
          ? eligibleStoryletPool(deck, state)
          : eligibleArcBeatPool(deck, state);
        const selected = weightedPoolPick(rebuilt, rng);
        if (selected) {
          state.currentCardId = selected.id;
          return;
        }
        const stalled = takeDueCallback(deck, state) || takeEarliestPendingCallback(deck, state);
        if (stalled) {
          // Keep the pool mode: a callback delivered out of a storylet stall
          // must resume the storylet pool, not the (empty) arc pool.
          markQueuedPool(state, transition.poolMode === 'storylet' ? 'storylet' : 'pool');
          state.currentCardId = stalled.id;
          if (stalled.kind === 'pressure') state.pressureCount += 1;
          return;
        }
        const filler = pickBackgroundFiller(deck, state, rng);
        if (filler) {
          markQueuedPool(state, transition.poolMode === 'storylet' ? 'storylet' : 'pool');
          (state.fillerCards = state.fillerCards || []).push(filler.id);
          state.currentCardId = filler.id;
          return;
        }
        endWithoutProof(state);
        return;
      }
      const preferred = cardById(deck, transition.preferredId);
      if (preferred && cardIsEligible(deck, preferred, state)) {
        state.currentCardId = preferred.id;
        return;
      }
      const selected = weightedPoolPick(eligibleStoryPool(deck, state, nextIds), rng);
      if (selected) {
        state.currentCardId = selected.id;
        return;
      }
      endWithoutProof(state);
      return;
    }

    if (transition.mode === 'weighted' || isPoolLikeMode(transition.mode)) {
      const storyPool = poolForMode(deck, state, transition, nextIds);
      if (!storyPool.length) {
        // Pool modes only: the pool can be empty transiently while a callback
        // is pending (the glue entry is gated by excludesPendingCallbacks).
        // Deliver the callback rather than ending with no_proof. Weighted mode
        // keeps its original behavior untouched.
        if (isPoolLikeMode(transition.mode)) {
          const stalled = takeDueCallback(deck, state) || takeEarliestPendingCallback(deck, state);
          if (stalled) {
            // Keep the pool mode so the post-callback resume rebuilds the same
            // pool this transition was draining (storylet stall -> storylet).
            markQueuedPool(state, transition.mode);
            state.currentCardId = stalled.id;
            if (stalled.kind === 'pressure') state.pressureCount += 1;
            return;
          }
          const filler = pickBackgroundFiller(deck, state, rng);
          if (filler) {
            markQueuedPool(state, transition.mode);
            (state.fillerCards = state.fillerCards || []).push(filler.id);
            state.currentCardId = filler.id;
            return;
          }
        }
        endWithoutProof(state);
        return;
      }
      const pressureSlotsLeft = Number(deck.meta.maxPressureCards || 4) - state.pressureCount;
      const dueCallback = takeDueCallback(deck, state);
      if (dueCallback) {
        const queuedStory = weightedPoolPick(storyPool, rng);
        state.queuedCardId = queuedStory.id;
        state.queuedCardIds = storyPool.map((entry) => entry.card.id);
        markQueuedPool(state, transition.mode);
        state.currentCardId = dueCallback.id;
        if (dueCallback.kind === 'pressure') state.pressureCount += 1;
        return;
      }
      const hasScheduledCallback = state.delayed.some((entry) => {
        const callback = cardById(deck, entry.card);
        return callback?.kind === 'pressure' && !state.shown.includes(entry.card);
      });
      const mayUseAmbient = pressureSlotsLeft > 0 && !(hasScheduledCallback && pressureSlotsLeft === 1);
      const ambientPool = mayUseAmbient
        ? buildEligiblePool(deck, state, { modes: ['ambient'] })
          .filter((entry) => entry.card.callbackOnly !== true)
        : [];
      const sideStoryPool = buildEligiblePool(deck, state, { modes: ['sideStory'] })
        .filter((entry) => entry.card.callbackOnly !== true)
        .filter((entry) => sideStoryCanInsert(entry.card, storyPool));
      const selected = weightedPoolPick([...storyPool, ...ambientPool, ...sideStoryPool], rng);
      if (!selected) {
        endWithoutProof(state);
        return;
      }
      if (['ambient', 'sideStory'].includes(continuationMode(selected))) {
        const queuedStory = weightedPoolPick(storyPool, rng);
        state.queuedCardId = queuedStory.id;
        state.queuedCardIds = storyPool.map((entry) => entry.card.id);
        markQueuedPool(state, transition.mode);
        if (continuationMode(selected) === 'ambient') state.pressureCount += 1;
      }
      state.currentCardId = selected.id;
      return;
    }

    const storyId = pickNextId(nextIds, rng);
    if (!storyId) {
      const fallback = eligibleFallbackPool(deck, state)[0]?.card;
      if (fallback) {
        state.currentCardId = fallback.id;
        return;
      }
      endWithoutProof(state);
      return;
    }
    state.queuedCardId = storyId;
    state.queuedCardIds = [storyId];
    const pressure = pickPressureCard(deck, state, rng);
    if (pressure) {
      state.currentCardId = pressure.id;
      state.pressureCount += 1;
      return;
    }
    state.queuedCardId = null;
    state.queuedCardIds = [];
    state.currentCardId = storyId;
  }

  function resolveChoice(deck, currentState, side, options = {}) {
    const rng = options.rng || Math.random;
    const state = cloneState(currentState);
    if (state.gameOver || state.activeCrisisId) {
      return { state, deltas: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])) };
    }
    const card = cardById(deck, state.currentCardId);
    if (!card) throw new Error(`Missing current card ${state.currentCardId}`);
    const choice = card.choices[side];
    if (!choice) throw new Error(`Missing ${side} choice on ${card.id}`);

    const resume = (['pressure', 'sideStory'].includes(card.kind) || schedulerRole(card)) && (state.queuedCardId || state.queuedPool)
      ? {
        mode: 'resume',
        pool: Boolean(state.queuedPool),
        poolMode: state.queuedPoolMode || 'pool',
        preferredId: state.queuedCardId,
        ids: state.queuedCardIds.length ? [...state.queuedCardIds] : (state.queuedCardId ? [state.queuedCardId] : []),
        skipScheduler: Boolean(state.queuedBoundary),
      }
      : null;
    if (resume) {
      state.queuedCardId = null;
      state.queuedCardIds = [];
      state.queuedBoundary = null;
      state.queuedPool = false;
      state.queuedPoolMode = null;
    }

    const deltas = applyEffects(deck, state, card, choice);
    applyFlags(state, choice);
    if (choice.startArc) state.activeArc = choice.startArc;
    if (choice.switchArc) state.activeArc = choice.switchArc;
    activateSchedulerLock(deck, state, card, choice);
    if (!state.shown.includes(card.id)) state.shown.push(card.id);
    state.history.push({ turn: state.turn, cardId: card.id, side, deltas });
    advanceStoryDelays(state, card);
    if (choice.delay) {
      const delayed = { card: choice.delay.card };
      if (choice.delay.storyDecisions != null) {
        delayed.remainingStoryDecisions = Number(choice.delay.storyDecisions);
      } else {
        delayed.dueAfter = state.history.length + Number(choice.delay.turns || 1);
      }
      state.delayed.push(delayed);
    }
    if (choice.reserveCallback) {
      const reservation = choice.reserveCallback;
      state.reservations = [{
        callbackId: reservation.callbackId,
        callbackSlot: reservation.callbackSlot,
        remainingSpineSteps: Number(reservation.spineSteps || 0),
        moduleId: card.scheduler && card.scheduler.moduleId,
      }];
    }
    state.turn += 1;

    const nextIds = resume ? resume.ids : asArray(choice.next);
    const openPressureSlot = card.kind !== 'pressure' && shouldOpenPressureSlot(deck, card, state);
    const transition = { ...(resume || transitionFor(card, openPressureSlot)), beforeId: card.id };
    const outcome = choice.ending || (choice.paid && choice.validationProof)
      ? { endingId: choice.ending || 'validation', win: Boolean(choice.paid && choice.validationProof) }
      : null;
    if (outcome && choice.terminalPriority === true) {
      finishOutcome(state, outcome);
      return { state, deltas };
    }
    const boundaryCrisisId = findBoundary(deck, state);
    const forcedCrisisId = choice.crisis && deck.crises[choice.crisis] ? choice.crisis : null;
    const crisisId = boundaryCrisisId || forcedCrisisId;
    if (crisisId) {
      state.activeCrisisId = crisisId;
      // Pool/weighted beats have no explicit next, but their continuation must
      // still survive a rescued crisis — otherwise the run strands on the
      // already-resolved beat. Preserve the transition even with an empty id list.
      const poolLikeContinuation = isPoolLikeMode(transition.mode)
        || transition.mode === 'weighted'
        || (transition.mode === 'resume' && transition.pool);
      state.pendingContinuation = (nextIds.length || poolLikeContinuation)
        ? { ...transition, ids: [...nextIds] }
        : null;
      state.postCrisisOutcome = outcome;
      return { state, deltas };
    }

    if (outcome) {
      if (outcome.win && !insideCorridor(deck, state)) {
        state.gameOver = true;
        state.endingId = 'no_proof';
      } else {
        finishOutcome(state, outcome);
      }
      return { state, deltas };
    }

    if (state.turn > Number(deck.meta.maxTurns || 24)) {
      endWithoutProof(state);
      return { state, deltas };
    }

    queueOrContinue(deck, state, nextIds, transition, rng, options.onSchedulerBoundary);
    return { state, deltas };
  }

  function resolveCrisis(deck, currentState, action, options = {}) {
    const rng = options.rng || Math.random;
    const state = cloneState(currentState);
    const before = { ...state.resources };
    const deltas = () => RESOURCE_KEYS.reduce((all, key) => {
      all[key] = state.resources[key] - before[key];
      return all;
    }, {});
    const crisis = deck.crises[state.activeCrisisId];
    if (!crisis) throw new Error(`Missing crisis ${state.activeCrisisId}`);
    if (action === 'giveup' || state.rescueAttempts >= 2) {
      state.gameOver = true;
      state.endingId = state.activeCrisisId;
      state.postCrisisOutcome = null;
      state.pendingContinuation = null;
      state.delayed = [];
      state.reservations = [];
      return { state, deltas: deltas() };
    }
    const chance = state.rescueAttempts === 0 ? 0.35 : 0.15;
    state.rescueAttempts += 1;
    if (rng() >= chance) {
      state.gameOver = true;
      state.endingId = state.activeCrisisId;
      state.postCrisisOutcome = null;
      state.pendingContinuation = null;
      state.delayed = [];
      state.reservations = [];
      return { state, deltas: deltas() };
    }

    state.resources[crisis.resource] = crisis.rebound;
    Object.entries(crisis.damage || {}).forEach(([key, amount]) => {
      const config = deck.resources[key];
      state.resources[key] = clamp(state.resources[key] + Number(amount), config.min, config.max);
    });
    state.activeCrisisId = findBoundary(deck, state);
    if (!state.activeCrisisId && state.postCrisisOutcome) {
      finishOutcome(state, state.postCrisisOutcome);
    } else if (!state.activeCrisisId && state.pendingContinuation) {
      const pending = state.pendingContinuation;
      state.pendingContinuation = null;
      queueOrContinue(deck, state, pending.ids, pending, rng);
    } else if (!state.activeCrisisId && state.queuedCardId) {
      state.currentCardId = state.queuedCardId;
      state.queuedCardId = null;
      state.queuedCardIds = [];
    }
    return { state, deltas: deltas() };
  }

  function formatSender(deck, card) {
    const source = deck.sources[card.source];
    return source.role ? `${source.role} ${source.name}` : source.name;
  }

  return {
    RESOURCE_KEYS,
    validateDeck,
    startRun,
    cloneState,
    getChoiceLabel,
    getAffectedResources,
    buildEligiblePool,
    buildBoundaryPool,
    eligibleArcBeatPool,
    eligibleStoryletPool,
    selectNextCard,
    resolveChoice,
    resolveCrisis,
    formatSender,
    cardById,
  };
});
