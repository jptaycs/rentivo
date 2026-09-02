import { SearchBar } from '@/components/search/SearchBar'

export function HeroSearch() {
  return (
    <section className="relative bg-[#003049]">
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight">
            Rent Professional<br className="hidden sm:block" />{' '}
            <span className="text-[#FDF0D5]">Cameras & Phones</span>
          </h1>
          <p className="mt-4 text-lg text-blue-100 max-w-xl mx-auto">
            Find the perfect camera, smartphone, or lens for your next shoot — from trusted owners near you.
          </p>
        </div>

        <SearchBar variant="hero" />
      </div>
    </section>
  )
}
