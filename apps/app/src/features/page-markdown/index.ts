// Client-safe public surface of the page-markdown feature: pure ".md" URL
// builders and the alternate-link helpers shared by the CopyDropdown UI, the
// page <Head>, and getServerSideProps. Server-side consumers (the Express
// route handlers) live behind './server' and must NOT be re-exported here.
export {
  selectAlternateMdUrl,
  toMarkdownAlternateLinkHeader,
} from './utils/page-markdown-alternate';
export { toPathMdUrl, toPermalinkMdUrl } from './utils/page-markdown-url';
