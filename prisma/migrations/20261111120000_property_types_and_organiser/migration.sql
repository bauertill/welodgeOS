-- More kinds of property, for the LA28 move from monday.com (doc §3.1).
ALTER TYPE "PropertyType" ADD VALUE 'MOTEL';
ALTER TYPE "PropertyType" ADD VALUE 'HOSTEL';
ALTER TYPE "PropertyType" ADD VALUE 'BED_AND_BREAKFAST';
ALTER TYPE "PropertyType" ADD VALUE 'EXTENDED_STAY';
ALTER TYPE "PropertyType" ADD VALUE 'STUDENT_HOUSING';
ALTER TYPE "PropertyType" ADD VALUE 'OTHER';

-- A hotel the event's organising committee has contracted: not available to us (doc §3.9).
ALTER TYPE "ScoutingStatus" ADD VALUE 'ORGANISER';
