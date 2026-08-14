'use client';

import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#4338ca', // indigo - conveys trust/fintech without being a literal brand copy
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#0f766e',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    error: { main: '#dc2626' },
    warning: { main: '#d97706' },
    success: { main: '#16a34a' },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { boxShadow: 'none', borderBottom: '1px solid #e2e8f0' },
      },
    },
  },
});
