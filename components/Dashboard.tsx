import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { 
  Activity, TrendingUp, TrendingDown, DollarSign, Brain, 
  Globe, Zap, LayoutDashboard, Settings, LogOut, BarChart2,
  ArrowUpDown, Search, Newspaper
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import TradingViewWidget from './TradingViewWidget';
import { auth, loginWithGoogle, logout, db } from '@/lib/firebase';
import { generateAIInsight, AIInsightResult } from '@/lib/ai';
import { 
  collection, doc, setDoc, getDoc, serverTimestamp, 
  onSnapshot, query, where, addDoc, deleteDoc, orderBy 
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';

// Mock Data for Portfolio Chart
const portfolioData = [
  { name: 'Jan', value: 95000 },
  { name: 'Feb', value: 98000 },
  { name: 'Mar', value: 96500 },
  { name: 'Apr', value: 105000 },
  { name: 'May', value: 112000 },
  { name: 'Jun', value: 118000 },
  { name: 'Jul', value: 124500 },
];

const defaultHoldings = [
  { id: '1', symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'AMEX', quantity: 150, avgPrice: 450, currentPrice: 510.25, change: 1.2 },
  { id: '2', symbol: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', quantity: 200, avgPrice: 380, currentPrice: 440.50, change: 0.8 },
  { id: '3', symbol: 'NIFTYBEES', name: 'Nippon India ETF Nifty 50 BeES', exchange: 'NSE', quantity: 5000, avgPrice: 200, currentPrice: 245.10, change: -0.5 },
  { id: '4', symbol: 'GOLD', name: 'SPDR Gold Trust', exchange: 'NYSEARCA', quantity: 100, avgPrice: 180, currentPrice: 210.30, change: 0.1 },
];

const mockNews = [
  { id: 1, title: "Fed signals potential rate cuts later this year amid cooling inflation", source: "Financial Times", time: "2h ago" },
  { id: 2, title: "Tech sector rallies on strong earnings reports from mega-caps", source: "Reuters", time: "4h ago" },
  { id: 3, title: "Global markets show resilience despite ongoing geopolitical tensions", source: "Bloomberg", time: "5h ago" },
];

type SortKey = keyof typeof defaultHoldings[0];

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'markets' | 'signals' | 'settings'>('dashboard');
  const [marketIndices, setMarketIndices] = useState([
    { symbol: 'INDEX:SPX', name: 'S&P 500', exchange: 'US' },
    { symbol: 'INDEX:NDX', name: 'Nasdaq 100', exchange: 'US' },
    { symbol: 'NSE:NIFTY', name: 'Nifty 50', exchange: 'India' },
    { symbol: 'BSE:SENSEX', name: 'Sensex', exchange: 'India' },
  ]);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState(marketIndices[0]);
  const [selectedMarketPrice, setSelectedMarketPrice] = useState<{ price: number, change: number } | null>(null);
  
  useEffect(() => {
    const fetchMarketPrice = async () => {
      try {
        const response = await fetch(`/api/price/${selectedMarketIndex.symbol}`);
        const data = await response.json();
        if (data.price) {
          setSelectedMarketPrice({ price: data.price, change: data.change || 0 });
        }
      } catch (error) {
        console.error(`Error fetching price for ${selectedMarketIndex.symbol}:`, error);
      }
    };
    fetchMarketPrice();
  }, [selectedMarketIndex]);
  
  const [holdings, setHoldings] = useState<any[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isAddAssetOpen, setIsAddAssetOpen] = useState(false);
  
  const [newAsset, setNewAsset] = useState({
    symbol: '',
    name: '',
    exchange: 'NASDAQ',
    quantity: '',
    avgPrice: ''
  });
  
  const [allInsights, setAllInsights] = useState<Record<string, AIInsightResult>>({});
  const [analyzingState, setAnalyzingState] = useState<Record<string, boolean>>({});
  
  const [filterText, setFilterText] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        getDoc(userRef).then((docSnap) => {
          if (!docSnap.exists()) {
            setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              role: 'user',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            }).catch(e => console.error("Error creating user doc", e));
          } else {
            setDoc(userRef, {
              email: currentUser.email || '',
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              updatedAt: serverTimestamp()
            }, { merge: true }).catch(e => console.error("Error updating user doc", e));
          }
        }).catch(e => console.error("Error checking user doc", e));
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Holdings Sync
  useEffect(() => {
    if (!user) {
      setHoldings([]);
      return;
    }

    const q = query(
      collection(db, 'holdings'), 
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const holdingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // If no holdings exist, seed with defaults for first-time users
      if (holdingsData.length === 0 && user) {
        defaultHoldings.forEach(async (h) => {
          const { id, ...rest } = h;
          await addDoc(collection(db, 'holdings'), {
            ...rest,
            uid: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
      } else {
        setHoldings(holdingsData);
      }
    }, (error) => {
      console.error("Error fetching holdings:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const holdingsRef = React.useRef(holdings);
  useEffect(() => {
    holdingsRef.current = holdings;
  }, [holdings]);

  // Real-time Price Fetching
  useEffect(() => {
    const fetchPrices = async () => {
      const currentHoldings = holdingsRef.current;
      // Create a map of new prices
      const prices: Record<string, number> = {};
      for (const h of currentHoldings) {
        try {
          const response = await fetch(`/api/price/${h.symbol}`);
          const data = await response.json();
          if (data.price) prices[h.symbol] = data.price;
        } catch (error) {
          console.error(`Error fetching price for ${h.symbol}:`, error);
        }
      }

      // Update holdings with new prices
      setHoldings(prev => prev.map(h => {
        if (prices[h.symbol]) {
          const newPrice = prices[h.symbol];
          const newChange = ((newPrice - h.avgPrice) / h.avgPrice) * 100;
          return { ...h, currentPrice: newPrice, change: newChange };
        }
        return h;
      }));
    };

    const interval = setInterval(fetchPrices, 60000); // Fetch every minute
    fetchPrices(); // Initial fetch
    return () => clearInterval(interval);
  }, []); // Run only once on mount

  // Fetch AI Insights for all holdings sequentially to avoid rate limits
  useEffect(() => {
    let isMounted = true;
    const fetchAllInsights = async () => {
      for (const asset of holdings) {
        if (!isMounted) break;
        if (allInsights[asset.symbol]) continue; // Skip if already fetched
        
        setAnalyzingState(prev => ({ ...prev, [asset.symbol]: true }));
        try {
          const result = await generateAIInsight(asset.symbol, asset.exchange);
          if (isMounted) {
            setAllInsights(prev => ({ ...prev, [asset.symbol]: result }));
          }
        } catch (error: any) {
          console.error(`Failed to fetch insight for ${asset.symbol}:`, error);
          if (error.status === 429 || error.message?.includes('429')) {
            console.warn("Rate limit exceeded. Stopping AI analysis.");
            setAnalyzingState(prev => ({ ...prev, [asset.symbol]: false }));
            break; // Stop the loop
          }
        } finally {
          if (isMounted) {
            setAnalyzingState(prev => ({ ...prev, [asset.symbol]: false }));
          }
        }
        // Increased delay to 10 seconds between calls to respect API limits
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    };

    if (user && holdings.length > 0) {
      fetchAllInsights();
    }
    return () => { isMounted = false; };
  }, [user, holdings]);

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      await addDoc(collection(db, 'holdings'), {
        uid: user.uid,
        symbol: newAsset.symbol.toUpperCase(),
        name: newAsset.name || newAsset.symbol.toUpperCase(),
        exchange: newAsset.exchange,
        quantity: parseFloat(newAsset.quantity),
        avgPrice: parseFloat(newAsset.avgPrice),
        currentPrice: parseFloat(newAsset.avgPrice), // Initial price
        change: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setIsAddAssetOpen(false);
      setNewAsset({ symbol: '', name: '', exchange: 'NASDAQ', quantity: '', avgPrice: '' });
    } catch (error) {
      console.error("Error adding asset:", error);
    }
  };

  const handleDeleteAsset = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this asset?")) return;
    try {
      await deleteDoc(doc(db, 'holdings', id));
      setIsDetailModalOpen(false);
    } catch (error) {
      console.error("Error deleting asset:", error);
    }
  };

  const refreshAIInsight = async (symbol: string, exchange: string) => {
    setAnalyzingState(prev => ({ ...prev, [symbol]: true }));
    try {
      const result = await generateAIInsight(symbol, exchange);
      setAllInsights(prev => ({ ...prev, [symbol]: result }));
    } catch (error) {
      console.error(`Failed to refresh insight for ${symbol}:`, error);
    } finally {
      setAnalyzingState(prev => ({ ...prev, [symbol]: false }));
    }
  };

  // Sorting and Filtering Logic
  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedHoldings = useMemo(() => {
    let result = [...holdings];
    
    if (filterText) {
      const lower = filterText.toLowerCase();
      result = result.filter(h => 
        h.symbol.toLowerCase().includes(lower) || 
        h.name.toLowerCase().includes(lower)
      );
    }
    
    if (sortConfig) {
      result.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return result;
  }, [holdings, filterText, sortConfig]);

  const openAssetDetails = (asset: any) => {
    setSelectedAsset(asset);
    setIsDetailModalOpen(true);
  };

  if (!isAuthReady) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading Deep Mind AI...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,_#1a1a2e_0%,_#000000_60%)] opacity-80"></div>
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="z-10 flex flex-col items-center text-center max-w-2xl px-6"
        >
          <div className="w-24 h-24 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(37,99,235,0.3)]">
            <Brain className="w-12 h-12 text-blue-400" />
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
            Deep Mind ALGO
          </h1>
          <p className="text-lg md:text-xl text-gray-400 mb-10 font-light leading-relaxed">
            World-class portfolio management powered by advanced quantitative AI. 
            Real-time market sentiment, 24/7 analysis, and multi-device cloud sync.
          </p>
          <Button 
            onClick={loginWithGoogle}
            size="lg" 
            className="bg-white text-black hover:bg-gray-200 rounded-full px-8 py-6 text-lg font-medium transition-all hover:scale-105"
          >
            <Globe className="mr-2 h-5 w-5" />
            Connect & Sync Devices
          </Button>
        </motion.div>
      </div>
    );
  }

  const totalValue = holdings.reduce((sum, h) => sum + (h.currentPrice * h.quantity), 0);
  const totalCost = holdings.reduce((sum, h) => sum + (h.avgPrice * h.quantity), 0);
  const totalReturn = totalValue - totalCost;
  const totalReturnPct = (totalReturn / totalCost) * 100;

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 bg-black/50 backdrop-blur-xl flex flex-col hidden md:flex">
        <div className="p-6 flex items-center gap-3 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.5)]">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">DeepMind ALGO</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <Button 
            variant="ghost" 
            className={`w-full justify-start ${activeTab === 'dashboard' ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard className="mr-3 h-5 w-5" /> Dashboard
          </Button>
          <Button 
            variant="ghost" 
            className={`w-full justify-start ${activeTab === 'markets' ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            onClick={() => setActiveTab('markets')}
          >
            <BarChart2 className="mr-3 h-5 w-5" /> Markets
          </Button>
          <Button 
            variant="ghost" 
            className={`w-full justify-start ${activeTab === 'signals' ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            onClick={() => setActiveTab('signals')}
          >
            <Activity className="mr-3 h-5 w-5" /> AI Signals
          </Button>
          <Button 
            variant="ghost" 
            className={`w-full justify-start ${activeTab === 'settings' ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings className="mr-3 h-5 w-5" /> Settings
          </Button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-4">
            <Avatar className="h-10 w-10 border border-white/20">
              <AvatarImage src={user.photoURL || ''} />
              <AvatarFallback>{user.displayName?.charAt(0) || 'U'}</AvatarFallback>
            </Avatar>
            <div className="overflow-hidden">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full border-white/10 text-gray-400 hover:text-white hover:bg-white/5" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" /> Disconnect
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative">
        {/* Top Header */}
        <header className="h-16 border-b border-white/10 bg-black/50 backdrop-blur-md flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-6">
            <h2 className="text-xl font-semibold">Portfolio Overview</h2>
            <div className="hidden lg:flex items-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                <span>NYSE: Open</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                <span>NSE: Closed</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button 
              onClick={() => setIsAddAssetOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-4 h-9 text-sm"
            >
              + Add Asset
            </Button>
            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 px-3 py-1">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
              Ultra-Fast Sync Active
            </Badge>
          </div>
        </header>

        <ScrollArea className="flex-1 p-6 h-full">
          <div className="max-w-7xl mx-auto space-y-6 pb-12">
            
            {activeTab === 'dashboard' && (
              <>
                {/* Top Stats Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="bg-[#111] border-white/10 overflow-hidden relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400 flex items-center">
                        <DollarSign className="w-4 h-4 mr-1" /> Total Value
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <p className={`text-sm flex items-center mt-1 ${totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {totalReturn >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                        {totalReturn >= 0 ? '+' : ''}${totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({totalReturnPct.toFixed(2)}%) All Time
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-[#111] border-white/10 overflow-hidden relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400 flex items-center">
                        <Brain className="w-4 h-4 mr-1" /> Overall AI Sentiment
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight text-green-400">Bullish</div>
                      <p className="text-sm text-gray-500 mt-1">Based on {holdings.length} ETF holdings</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-[#111] border-white/10 overflow-hidden relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400 flex items-center">
                        <Zap className="w-4 h-4 mr-1" /> Active ALGOs
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight">{holdings.length} Running</div>
                      <p className="text-sm text-gray-500 mt-1">24/7 Market Scanning</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Portfolio Performance Chart */}
                <Card className="bg-[#111] border-white/10">
                  <CardHeader>
                    <CardTitle>Portfolio Performance (YTD)</CardTitle>
                    <CardDescription>Historical total value across all connected accounts</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={portfolioData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="name" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis 
                          stroke="#888" 
                          fontSize={12} 
                          tickLine={false} 
                          axisLine={false} 
                          tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} 
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px', color: '#fff' }}
                          itemStyle={{ color: '#3b82f6' }}
                          formatter={(value: number) => [`$${value.toLocaleString()}`, 'Portfolio Value']}
                        />
                        <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Holdings Table with Filters */}
                <Card className="bg-[#111] border-white/10">
                  <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle>ETF Portfolio Holdings</CardTitle>
                      <CardDescription>Synced across all devices via Cloud</CardDescription>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                      <Input 
                        type="text" 
                        placeholder="Search assets..." 
                        className="pl-9 bg-black/50 border-white/10 focus-visible:ring-blue-500"
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border border-white/10 overflow-hidden">
                      <Table>
                        <TableHeader className="bg-black/40">
                          <TableRow className="border-white/10 hover:bg-transparent">
                            <TableHead className="text-gray-400 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('symbol')}>
                              <div className="flex items-center">Asset <ArrowUpDown className="ml-2 h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="text-gray-400 text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('quantity')}>
                              <div className="flex items-center justify-end">Quantity <ArrowUpDown className="ml-2 h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="text-gray-400 text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('avgPrice')}>
                              <div className="flex items-center justify-end">Avg Price <ArrowUpDown className="ml-2 h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="text-gray-400 text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('currentPrice')}>
                              <div className="flex items-center justify-end">Current Price <ArrowUpDown className="ml-2 h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="text-gray-400 text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('change')}>
                              <div className="flex items-center justify-end">Return <ArrowUpDown className="ml-2 h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="text-gray-400 text-center">AI Signal</TableHead>
                            <TableHead className="text-gray-400 text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredAndSortedHoldings.map((holding) => {
                            const isAnalyzing = analyzingState[holding.symbol];
                            const insight = allInsights[holding.symbol];
                            
                            return (
                              <TableRow 
                                key={holding.id} 
                                className="border-white/10 cursor-pointer transition-colors hover:bg-white/5"
                                onClick={() => openAssetDetails(holding)}
                              >
                                <TableCell>
                                  <div className="font-medium text-white">{holding.symbol}</div>
                                  <div className="text-xs text-gray-500">{holding.name}</div>
                                </TableCell>
                                <TableCell className="text-right font-mono">{holding.quantity.toLocaleString()}</TableCell>
                                <TableCell className="text-right font-mono">${holding.avgPrice.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-white">
                                  <motion.span
                                    key={holding.currentPrice}
                                    initial={{ color: '#fff' }}
                                    animate={{ color: holding.change > 0 ? '#4ade80' : '#f87171' }}
                                    transition={{ duration: 0.5 }}
                                  >
                                    ${holding.currentPrice.toFixed(2)}
                                  </motion.span>
                                </TableCell>
                                <TableCell className={`text-right font-mono ${holding.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {holding.change >= 0 ? '+' : ''}{holding.change.toFixed(2)}%
                                </TableCell>
                                <TableCell className="text-center">
                                  {isAnalyzing ? (
                                    <div className="flex items-center justify-center">
                                      <div className="w-4 h-4 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin"></div>
                                    </div>
                                  ) : insight ? (
                                    <Badge className={
                                      insight.signal.includes('BUY') ? 'bg-green-500/20 text-green-400 border-green-500/50' :
                                      insight.signal.includes('SELL') ? 'bg-red-500/20 text-red-400 border-red-500/50' :
                                      'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
                                    }>
                                      {insight.signal}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-gray-500">Pending</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="sm" className="h-8 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20">
                                    Details
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {filteredAndSortedHoldings.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                                No assets found matching your search.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {activeTab === 'markets' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {marketIndices.map(index => (
                    <Card 
                      key={index.symbol} 
                      className={`bg-[#111] border-white/10 cursor-pointer transition-all ${selectedMarketIndex.symbol === index.symbol ? 'ring-2 ring-blue-500' : 'hover:bg-white/5'}`}
                      onClick={() => setSelectedMarketIndex(index)}
                    >
                      <CardContent className="p-4">
                        <p className="text-xs text-gray-500 mb-1">{index.exchange}</p>
                        <h4 className="font-bold">{index.name}</h4>
                        <p className="text-xs text-gray-400">{index.symbol}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="bg-[#111] border-white/10">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>{selectedMarketIndex.name} Overview</CardTitle>
                      <CardDescription>Real-time market data for {selectedMarketIndex.symbol}</CardDescription>
                    </div>
                    {selectedMarketPrice && (
                      <div className="text-right">
                        <div className="text-2xl font-bold">${selectedMarketPrice.price.toLocaleString()}</div>
                        <div className={`text-sm ${selectedMarketPrice.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {selectedMarketPrice.change >= 0 ? '+' : ''}{selectedMarketPrice.change.toFixed(2)}%
                        </div>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="h-[500px]">
                    <TradingViewWidget key={selectedMarketIndex.symbol} symbol={selectedMarketIndex.symbol} theme="dark" />
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'signals' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold">AI Signal Center</h3>
                    <p className="text-sm text-gray-500">Deep Mind quantitative analysis for your entire portfolio</p>
                  </div>
                  <Button 
                    variant="outline" 
                    className="border-white/10 hover:bg-white/5"
                    onClick={() => {
                      holdings.forEach(h => refreshAIInsight(h.symbol, h.exchange));
                    }}
                  >
                    Refresh All Signals
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {holdings.map(asset => (
                    <Card key={asset.id} className="bg-[#111] border-white/10 hover:border-blue-500/30 transition-colors cursor-pointer" onClick={() => openAssetDetails(asset)}>
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div>
                          <CardTitle className="text-lg">{asset.symbol}</CardTitle>
                          <CardDescription className="text-xs">{asset.name}</CardDescription>
                        </div>
                        {analyzingState[asset.symbol] ? (
                          <div className="w-4 h-4 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin"></div>
                        ) : (
                          <Badge className={
                            allInsights[asset.symbol]?.signal.includes('BUY') ? 'bg-green-500/20 text-green-400 border-green-500/50' :
                            allInsights[asset.symbol]?.signal.includes('SELL') ? 'bg-red-500/20 text-red-400 border-red-500/50' :
                            'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
                          }>
                            {allInsights[asset.symbol]?.signal || 'WAITING'}
                          </Badge>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Confidence</span>
                            <span className="font-mono text-blue-400">{allInsights[asset.symbol]?.confidence || 0}%</span>
                          </div>
                          <p className="text-sm text-gray-300 line-clamp-3 italic">
                            "{allInsights[asset.symbol]?.reasoning || 'Deep Mind is scanning market data for this asset...'}"
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <Card className="bg-[#111] border-white/10">
                <CardHeader>
                  <CardTitle>Account Settings</CardTitle>
                  <CardDescription>Manage your Deep Mind ALGO preferences</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-black/40 rounded-lg border border-white/5">
                    <div>
                      <p className="font-medium">Cloud Sync Status</p>
                      <p className="text-sm text-gray-500">Your data is synced across 3 devices</p>
                    </div>
                    <Badge className="bg-green-500/20 text-green-400">Connected</Badge>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-black/40 rounded-lg border border-white/5">
                    <div>
                      <p className="font-medium">AI Analysis Frequency</p>
                      <p className="text-sm text-gray-500">Real-time deep scanning enabled</p>
                    </div>
                    <Badge variant="outline">Every 15m</Badge>
                  </div>
                </CardContent>
              </Card>
            )}

          </div>
        </ScrollArea>
      </main>

      {/* Add Asset Modal */}
      <Dialog open={isAddAssetOpen} onOpenChange={setIsAddAssetOpen}>
        <DialogContent className="bg-[#111] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Add New Asset</DialogTitle>
            <DialogDescription>Enter the details of your ETF or Stock holding.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAsset} className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-gray-400">Symbol</label>
                <Input 
                  required
                  placeholder="e.g. SPY, NIFTYBEES" 
                  className="bg-black border-white/10"
                  value={newAsset.symbol}
                  onChange={e => setNewAsset({...newAsset, symbol: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-gray-400">Exchange</label>
                <select 
                  className="w-full h-10 bg-black border border-white/10 rounded-md px-3 text-sm"
                  value={newAsset.exchange}
                  onChange={e => setNewAsset({...newAsset, exchange: e.target.value})}
                >
                  <option value="AMEX">AMEX (US)</option>
                  <option value="NASDAQ">NASDAQ (US)</option>
                  <option value="NYSE">NYSE (US)</option>
                  <option value="NSE">NSE (India)</option>
                  <option value="BSE">BSE (India)</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Asset Name</label>
              <Input 
                placeholder="e.g. SPDR S&P 500 ETF" 
                className="bg-black border-white/10"
                value={newAsset.name}
                onChange={e => setNewAsset({...newAsset, name: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-gray-400">Quantity</label>
                <Input 
                  required
                  type="number"
                  step="any"
                  placeholder="0.00" 
                  className="bg-black border-white/10"
                  value={newAsset.quantity}
                  onChange={e => setNewAsset({...newAsset, quantity: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-gray-400">Avg Buy Price</label>
                <Input 
                  required
                  type="number"
                  step="any"
                  placeholder="0.00" 
                  className="bg-black border-white/10"
                  value={newAsset.avgPrice}
                  onChange={e => setNewAsset({...newAsset, avgPrice: e.target.value})}
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setIsAddAssetOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Add to Portfolio</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detailed View Modal */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-7xl bg-[#0a0a0a] border-white/10 text-white h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-white/10 bg-[#111]">
            <DialogTitle className="text-2xl flex items-center gap-3">
              {selectedAsset?.symbol} 
              <Badge variant="secondary" className="bg-white/10 text-xs font-normal">{selectedAsset?.exchange}</Badge>
              <span className="text-lg font-mono ml-auto">
                ${selectedAsset?.currentPrice.toFixed(2)}
                <span className={`ml-2 text-sm ${selectedAsset && selectedAsset.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {selectedAsset && selectedAsset.change >= 0 ? '+' : ''}{selectedAsset?.change.toFixed(2)}%
                </span>
              </span>
              <Button 
                variant="destructive" 
                size="sm" 
                className="ml-4 h-8"
                onClick={() => selectedAsset && handleDeleteAsset(selectedAsset.id)}
              >
                Delete
              </Button>
            </DialogTitle>
            <DialogDescription className="text-gray-400">{selectedAsset?.name}</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-0 overflow-hidden">
            {/* Left Side: Chart */}
            <div className="lg:col-span-2 flex flex-col h-full border-r border-white/10 bg-black relative">
              {selectedAsset && (
                <div className="flex-1">
                  <TradingViewWidget symbol={`${selectedAsset.exchange}:${selectedAsset.symbol}`} theme="dark" />
                </div>
              )}
            </div>
            
            {/* Right Side: AI & News */}
            <div className="h-full flex flex-col bg-[#111] overflow-hidden">
              <section className="flex-1 overflow-y-auto p-6 border-b border-white/10">
                {/* AI Insight Section */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-blue-400">
                      <Brain className="w-5 h-5" /> Deep Mind Analysis
                    </h3>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 text-xs text-gray-400 hover:text-white"
                      onClick={() => selectedAsset && refreshAIInsight(selectedAsset.symbol, selectedAsset.exchange)}
                      disabled={selectedAsset && analyzingState[selectedAsset.symbol]}
                    >
                      Refresh AI
                    </Button>
                  </div>
                  
                  {selectedAsset && analyzingState[selectedAsset.symbol] ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                      <div className="w-8 h-8 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin"></div>
                      <p className="text-sm text-blue-400 animate-pulse">Analyzing real-time data...</p>
                    </div>
                  ) : selectedAsset && allInsights[selectedAsset.symbol] ? (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">ALGO Signal</span>
                        <Badge className={
                          allInsights[selectedAsset.symbol].signal.includes('BUY') ? 'bg-green-500/20 text-green-400 border-green-500/50 text-sm py-1' :
                          allInsights[selectedAsset.symbol].signal.includes('SELL') ? 'bg-red-500/20 text-red-400 border-red-500/50 text-sm py-1' :
                          'bg-yellow-500/20 text-yellow-400 border-yellow-500/50 text-sm py-1'
                        }>
                          {allInsights[selectedAsset.symbol].signal}
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-400">AI Confidence</span>
                          <span className="font-mono">{allInsights[selectedAsset.symbol].confidence}%</span>
                        </div>
                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${allInsights[selectedAsset.symbol].confidence}%` }}
                            transition={{ duration: 1 }}
                            className={`h-full ${
                              allInsights[selectedAsset.symbol].confidence > 75 ? 'bg-green-500' : 
                              allInsights[selectedAsset.symbol].confidence > 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <span className="text-sm text-gray-400">Market Sentiment</span>
                        <p className="text-sm font-medium">{allInsights[selectedAsset.symbol].sentiment}</p>
                      </div>

                      <div className="space-y-2">
                        <span className="text-sm text-gray-400">Deep Mind Reasoning</span>
                        <p className="text-sm text-gray-300 leading-relaxed bg-black/40 p-4 rounded-lg border border-white/5">
                          {allInsights[selectedAsset.symbol].reasoning}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No AI insight available.</p>
                  )}
                </section>

                <hr className="border-white/10" />

                {/* News Section */}
                <section>
                  <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
                    <Newspaper className="w-5 h-5 text-gray-400" /> Live Market News
                  </h3>
                  <div className="space-y-4">
                    {mockNews.map(news => (
                      <div key={news.id} className="group cursor-pointer">
                        <h4 className="text-sm font-medium text-gray-200 group-hover:text-blue-400 transition-colors leading-snug">
                          {news.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                          <span>{news.source}</span>
                          <span>•</span>
                          <span>{news.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </section>

              </div>
            </div>
          </DialogContent>
      </Dialog>
    </div>
  );
}
