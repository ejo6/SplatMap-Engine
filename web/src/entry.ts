if (location.pathname === '/') {
  void import('./landing');
} else if (location.pathname === '/unavailable') {
  void import('./unavailable');
} else {
  void import('./main');
}
