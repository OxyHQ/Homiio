import React, { createContext, useContext, useState } from 'react';

interface SearchModeContextType {
    isMapMode: boolean;
    setIsMapMode: (isMapMode: boolean) => void;
}

const SearchModeContext = createContext<SearchModeContextType | undefined>(undefined);

export const useSearchMode = () => {
    const context = useContext(SearchModeContext);
    if (!context) {
        throw new Error('useSearchMode must be used within a SearchModeProvider');
    }
    return context;
};

interface SearchModeProviderProps {
    children: React.ReactNode;
}

export const SearchModeProvider: React.FC<SearchModeProviderProps> = ({ children }) => {
    const [isMapMode, setIsMapMode] = useState(true);

    const value: SearchModeContextType = {
        isMapMode,
        setIsMapMode,
    };

    return (
        <SearchModeContext.Provider value={value}>
            {children}
        </SearchModeContext.Provider>
    );
};
