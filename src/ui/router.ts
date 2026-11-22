/** 极简哈希路由 */
export type Route = 'press' | 'inspect' | 'trend' | 'calibration';

const ROUTES: Route[] = ['press', 'inspect', 'trend', 'calibration'];

export function currentRoute(): Route {
  const h = location.hash.replace('#/', '') as Route;
  return ROUTES.includes(h) ? h : 'press';
}

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}

export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = () => fn(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
