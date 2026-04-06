import { useAppStore } from "../state/store";

/**
 * Fine-grained subscriptions for communication domain:
 * messages, channels, threads, search state.
 */
export function useCommunicationController() {
  const selectedCommunicationEntityId = useAppStore((s) => s.selectedCommunicationEntityId);
  const setSelectedCommunicationEntityId = useAppStore((s) => s.setSelectedCommunicationEntityId);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const searchScope = useAppStore((s) => s.searchScope);
  const setSearchScope = useAppStore((s) => s.setSearchScope);
  const searchResults = useAppStore((s) => s.searchResults);
  const setSearchResults = useAppStore((s) => s.setSearchResults);
  const searchLoading = useAppStore((s) => s.searchLoading);
  const setSearchLoading = useAppStore((s) => s.setSearchLoading);
  const clearSearch = useAppStore((s) => s.clearSearch);
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const setActiveThreadId = useAppStore((s) => s.setActiveThreadId);

  return {
    selectedCommunicationEntityId,
    setSelectedCommunicationEntityId,
    searchQuery,
    setSearchQuery,
    searchScope,
    setSearchScope,
    searchResults,
    setSearchResults,
    searchLoading,
    setSearchLoading,
    clearSearch,
    activeThreadId,
    setActiveThreadId,
  };
}
