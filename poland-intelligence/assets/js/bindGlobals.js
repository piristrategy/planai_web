import * as core from './destination.core.js';
import { navigateToScreen } from './router.js';

const GLOBALS = [
  'toggleRec', 'trackRecRead', 'toggleSigTrace', 'filtSom', 'copyReport', 'ask',
  'stPick', 'stBuild', 'fbSave', 'pbFilter', 'submitRecFeedback', 'submitProfessionalFeedback',
  'submitStrategyFeedback', 'toggleInlineTranslation', 'setViewMode',
  'openDiosDecisionPanel', 'handleDiosPriorityAction', 'navigateToScreen', 'scrollToBriefTarget',
  'toggleDrillPanel', 'exportRecPdf', 'generateExecBriefing',
  'openPlaybookDrawer', 'closePlaybookDrawer', 'handlePlaybookAction', 'exportPlaybookBrief',
  'loadAnkaraReport', 'loadAdvisorLive', 'loadGoTurkiyeLive', 'loadMarketIntelligenceBundle',
];
export function bindGlobals() {
  for (const k of GLOBALS) {
    if (typeof core[k] === 'function') window[k] = core[k];
  }
  window.navigateToScreen = navigateToScreen;
}
