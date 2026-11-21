if (location.pathname === '/') {
  void import('./landing');
} else {
  void import('./main');
}
