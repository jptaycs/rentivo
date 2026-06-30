import { HeroSearch } from '@/components/home/HeroSearch'
import { CategoryCards } from '@/components/home/CategoryCards'
import { RecentlyViewed } from '@/components/home/RecentlyViewed'
import { FeaturedListings } from '@/components/home/FeaturedListings'
import { PopularCarousel } from '@/components/home/PopularCarousel'
import { CreatorBundles } from '@/components/home/CreatorBundles'
import { WhyRentivo } from '@/components/home/WhyRentivo'

export default function HomePage() {
  return (
    <>
      <HeroSearch />
      <CategoryCards />
      <RecentlyViewed />
      <FeaturedListings />
      <PopularCarousel />
      <CreatorBundles />
      <WhyRentivo />
    </>
  )
}
