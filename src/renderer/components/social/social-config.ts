import type { ElementType } from "react";
import {
  Browser,
  Camera,
  ChatCircle,
  Eye,
  Globe,
  Heart,
  MagnifyingGlass,
  PaperPlaneTilt,
  UserPlus,
  FacebookLogo,
  GlobeHemisphereWest,
  InstagramLogo,
  LinkedinLogo,
  RedditLogo,
  TiktokLogo,
  XLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import type { SocialPlatform } from "@shared/types";

export const platformConfig: Record<SocialPlatform, { label: string; color: string; bgColor: string; icon: ElementType }> = {
  twitter: { label: "Twitter / X", color: "#1D9BF0", bgColor: "#1D9BF014", icon: XLogo },
  linkedin: { label: "LinkedIn", color: "#0A66C2", bgColor: "#0A66C214", icon: LinkedinLogo },
  instagram: { label: "Instagram", color: "#E4405F", bgColor: "#E4405F14", icon: InstagramLogo },
  facebook: { label: "Facebook", color: "#1877F2", bgColor: "#1877F214", icon: FacebookLogo },
  reddit: { label: "Reddit", color: "#FF4500", bgColor: "#FF450014", icon: RedditLogo },
  youtube: { label: "YouTube", color: "#FF0000", bgColor: "#FF000014", icon: YoutubeLogo },
  tiktok: { label: "TikTok", color: "#111315", bgColor: "#11131514", icon: TiktokLogo },
  bluesky: { label: "Bluesky", color: "#0085FF", bgColor: "#0085FF14", icon: GlobeHemisphereWest },
  other: { label: "Other", color: "#6B7280", bgColor: "#6B728014", icon: GlobeHemisphereWest },
};

export const actionTypeLabels: Record<string, { label: string; icon: React.ElementType }> = {
  post: { label: "Post", icon: PaperPlaneTilt },
  reply: { label: "Reply", icon: ChatCircle },
  like: { label: "Like", icon: Heart },
  follow: { label: "Follow", icon: UserPlus },
  browse_feed: { label: "Browse Feed", icon: Eye },
  screenshot: { label: "Screenshot", icon: Camera },
  navigate: { label: "Navigate", icon: Globe },
  search: { label: "Search", icon: MagnifyingGlass },
  dm: { label: "Direct Message", icon: ChatCircle },
  custom_script: { label: "Legacy Action", icon: Browser },
};
