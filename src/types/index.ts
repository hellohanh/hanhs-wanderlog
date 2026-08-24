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
  category: 'attraction' | 'dining' | 'accommodation' | 'airport' | 'shopping' | 'cafe' | 'bakery'
  lat: number
  lng: number
  notes: string | null
  added_by: string
  created_at: string
}

export interface ItineraryDay {
  id: string
  trip_id: string
  day_number: number
  date: string
}

export interface ItineraryStop {
  id: string
  itinerary_day_id: string
  pin_id: string
  order_index: number
  arrival_time: string | null
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
