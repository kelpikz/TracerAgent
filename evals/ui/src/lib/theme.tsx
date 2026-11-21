import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'evals-theme';
const query = '(prefers-color-scheme: dark)';

function readStored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Storage is not available.
  }
  return 'system';
}

const ThemeContext = createContext<{ theme: Theme; resolved: 'light' | 'dark'; setTheme: (theme: Theme) => void }>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);

  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const media = matchMedia(query);
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      setResolved(dark ? 'dark' : 'light');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage is not available.
    }
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
