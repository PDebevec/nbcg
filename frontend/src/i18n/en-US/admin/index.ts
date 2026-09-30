import shell from './shell';
import dashboard from './dashboard';
import items from './items';
import validation from './validation';
import tasks from './tasks';
import edit from './edit';
import history from './history';
import stats from './stats';
import importMessages from './import';

// The `admin` namespace. Plain TypeScript modules: the i18n build plugin only
// precompiles .js / .json / .yaml resources, so these are composed like any
// other code. Both locales must keep the same shape (en-US is the typed schema).
export default {
  ...shell,
  dashboard,
  items,
  validation,
  tasks,
  edit,
  history,
  stats,
  import: importMessages,
};
