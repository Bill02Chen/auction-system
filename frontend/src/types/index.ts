export interface AuctionState {
  id: string;
  currentPrice: number;
  startPrice: number;
  minIncrement: number;
  maxPrice: number;
  endTime: number;
  status: string;
}

export interface RankItem {
  userId: string;
  userName: string;
  userAvatar: string;
  price: number;
  rank: number;
}

export interface BidData {
  auctionId: string;
  userId: string;
  userName: string;
  newPrice: number;
  timestamp: number;
}

export interface Auction {
  id: string;
  name: string;
  image: string;
  description: string;
  start_price: number;
  current_price: number;
  min_increment: number;
  max_price: number;
  duration: number;
  auto_delay_seconds: number;
  status: string;
  created_at: string;
}

export interface BidRecord {
  id: string;
  auction_id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  price: number;
  created_at: string;
}

export interface Order {
  id: string;
  auction_id: string;
  winner_id: string;
  winner_name: string;
  final_price: number;
  status: string;
  auction_name?: string;
  created_at: string;
}

export interface AuctionDetail {
  auction: Auction;
  bids: BidRecord[];
  order: Order | null;
}
