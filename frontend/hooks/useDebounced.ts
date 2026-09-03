'use client';

import { useEffect, useState } from 'react';

// Hold a value still until it has stopped changing for `ms`. Used to keep a
// search box from firing a request per keystroke.
//
// The same helper is inlined in three features/finance hooks files. This is the
// shared copy for new callers; those were left alone rather than refactored
// alongside an unrelated change.
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default useDebounced;
