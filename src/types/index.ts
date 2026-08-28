export interface Trip {
  id: string
  name: string
  destination: string
  start_date: string | null
  end_date: string | null
  owner_id: string
  invite_token: string
  created_at: string
}

export interface Pin {
  id: string
  trip_id: string
  name: string
  category: 'attraction' | 'dining' | 'accommodation' | 'airport' | 'transport' | 'shopping' | 'cafe' | 'bakery'
  lat: number
  lng: number
  notes: string | null
  place_id: string | null
  icon: string | null
  added_by: string
  created_at: string
}

export interface ItineraryDay {
  id: string
  trip_id: string
  day_number: number
  date: string | null
}

export interface ItineraryStop {
  id: string
  itinerary_day_id: string
  pin_id: string
  order_index: number
  start_time: string | null
  end_time: string | null
  notes: string | null
}

export type TravelMode = 'flight' | 'train' | 'bus' | 'personal'

export interface TravelLeg {
  id: string
  itinerary_day_id: string
  mode: TravelMode
  carrier: string | null
  reference: string | null
  title: string | null
  from_location: string
  from_date: string | null
  from_time: string | null
  from_timezone: string | null
  to_location: string
  to_date: string | null
  to_time: string | null
  to_timezone: string | null
  order_index: number
}

export interface BudgetItem {
  id: string
  trip_id: string
  label: string
  amount: number
  category: string
  added_by: string
}

export interface PackingItem {
  id: string
  trip_id: string
  label: string
  checked: boolean
}
