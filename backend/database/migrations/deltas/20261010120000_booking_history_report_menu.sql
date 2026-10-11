-- Keep Booking's menu ID, route, and grants so existing detail links keep working.
UPDATE iam.menus child
SET menu_name = 'Booking History', parent_id = parent.id, module = 'report',
    level = 2, order_number = 30, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'spa.bookings' AND parent.code = 'report';
