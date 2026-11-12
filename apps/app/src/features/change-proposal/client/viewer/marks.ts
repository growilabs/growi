// Entry for the revision-mark pieces used by SSR-rendered and sidebar screens. The main
// barrel also exports the detail and list components, which load diff2html and inject its
// styles at import time (browser only).
export { CurrentRevisionProposalMark } from './components/CurrentRevisionProposalMark';
export { ProposalMarkBadge } from './components/ProposalMarkBadge';
export { useSWRxRevisionMarks } from './stores/use-swrx-revision-marks';
