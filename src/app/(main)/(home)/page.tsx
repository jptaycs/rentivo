import { HeroSearch } from '@/components/home/HeroSearch'
import { CategoryCards } from '@/components/home/CategoryCards'
import { RecentlyViewed } from '@/components/home/RecentlyViewed'
import { FeaturedListings } from '@/components/home/FeaturedListings'
import { PopularCarousel } from '@/components/home/PopularCarousel'
import { CreatorBundles } from '@/components/home/CreatorBundles'
import { WhyRentivo } from '@/components/home/WhyRentivo'
import { getPopularListings } from '@/lib/listings'

export default async function HomePage() {
  const popular = await getPopularListings(12)

  return (
    <>
      <HeroSearch />
      <CategoryCards />
      <RecentlyViewed />
      <FeaturedListings />
      <PopularCarousel listings={popular} />
      <CreatorBundles />
      <WhyRentivo />
    </>
  )
}
