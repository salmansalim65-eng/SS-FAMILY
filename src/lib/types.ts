export type UserRole = 'head' | 'member' | 'driver'
export type MenuStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'rejected'
export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Priority = 'high' | 'medium' | 'low'
export type ShopStatus = 'pending' | 'purchased' | 'verified'
export type PrepType = 'homemade' | 'outside'
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snacks' | 'dessert'

export interface AppUser {
  id: string
  name: string
  email: string
  phone: string | null
  whatsapp_number: string | null
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface Guest {
  id: string
  name: string
  arrival_date: string
  departure_date: string | null
  male_count: number
  female_count: number
  total_guests: number
  relationship: string | null
  room: string | null
  special_needs: string | null
  phone: string | null
  origin_city: string | null
  google_calendar_event_id: string | null
  google_calendar_html_link: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  creator?: Pick<AppUser, 'id' | 'name'> | null
}

export interface MenuItem {
  id: string
  dish_name: string
  meal_type: MealType
  serve_date: string | null
  guest_id: string | null
  suggested_by: string | null
  status: MenuStatus
  approved_by: string | null
  approver_date: string | null
  rejection_reason: string | null
  cook_person: string | null
  homemade_or_outside: PrepType
  outside_responsible: string | null
  quantity: number
  unit: string | null
  cost: number
  notes: string | null
  created_at: string
  updated_at: string
  suggester?: Pick<AppUser, 'id' | 'name'> | null
  cook?: Pick<AppUser, 'id' | 'name'> | null
  outsider?: Pick<AppUser, 'id' | 'name'> | null
  approver?: Pick<AppUser, 'id' | 'name'> | null
  guest?: Pick<Guest, 'id' | 'name'> | null
}

export interface Task {
  id: string
  title: string
  description: string | null
  task_type: 'menu' | 'household' | 'shopping' | 'guest'
  assigned_to: string | null
  due_date: string | null
  due_time: string | null
  priority: Priority
  status: TaskStatus
  menu_item_id: string | null
  guest_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  assignee?: Pick<AppUser, 'id' | 'name'> | null
  guest?: Pick<Guest, 'id' | 'name'> | null
}

export interface ShoppingItem {
  id: string
  item_name: string
  normalized_name: string
  quantity: number
  unit: string
  category: string
  added_by: string | null
  status: ShopStatus
  priority: Priority
  notes: string | null
  guest_id: string | null
  purchased_by: string | null
  purchased_at: string | null
  created_at: string
  updated_at: string
  adder?: Pick<AppUser, 'id' | 'name'> | null
}

/** One line of the driver's list: every matching entry rolled into a total. */
export interface ConsolidatedItem {
  normalized_name: string
  item_name: string
  category: string
  unit: string
  total_quantity: number
  entry_count: number
  status: ShopStatus
  priority: Priority
  contributors: string[] | null
  source_ids: string[]
  first_added_at: string
  notes: string | null
}

export type NotificationType =
  | 'guest_added'
  | 'menu_suggested'
  | 'menu_approved'
  | 'menu_changed'
  | 'task_assigned'
  | 'task_due'
  | 'task_completed'
  | 'shopping_updated'
  | 'shopping_purchased'
  | 'guest_arriving'

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  message: string
  entity_type: string | null
  entity_id: string | null
  link: string | null
  sent_via: string[]
  whatsapp_status: 'not_sent' | 'queued' | 'sent' | 'failed' | 'disabled'
  whatsapp_error: string | null
  sent_at: string
  read_at: string | null
  created_at: string
}

export interface ActivityEntry {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  entity_label: string | null
  details: { from?: string | null; to?: string | null }
  created_at: string
}

export interface DashboardStats {
  upcoming_guests: number
  total_guest_heads: number
  menu_draft: number
  menu_approved: number
  menu_cost: number
  tasks_pending: number
  tasks_overdue: number
  tasks_due_soon: number
  shopping_pending: number
  unread_notifications: number
}

export const SHOPPING_CATEGORIES = [
  'Vegetables',
  'Fruits',
  'Meat',
  'Chicken',
  'Fish',
  'Dairy',
  'Grains',
  'Spices',
  'Bakery',
  'Beverages',
  'Frozen',
  'Household',
  'Other',
] as const

export const UNITS = ['kg', 'g', 'litre', 'ml', 'pcs', 'pack', 'bunch', 'dozen', 'carton', 'box'] as const

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert']
