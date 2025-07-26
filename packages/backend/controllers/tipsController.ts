import { Request, Response } from 'express';

interface TipArticle {
  id: string;
  title: string;
  description: string;
  category: string;
  readTime: string;
  publishDate: string;
  icon: string;
  gradientColors: string[];
  content: string;
  slug: string;
  author: string;
  tags: string[];
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

// Mock data - in production this would come from a database
const mockTipsData: TipArticle[] = [
  {
    id: 'first-time-renting',
    slug: 'first-time-renting-complete-guide',
    title: 'First Time Renting? Here\'s Your Complete Guide',
    description: 'Everything you need to know about finding, viewing, and securing your first rental property.',
    category: 'search',
    readTime: '5 min read',
    publishDate: '2 days ago',
    icon: 'search',
    gradientColors: ['#0047bf', '#0066ff'],
    author: 'Homiio Team',
    tags: ['first-time', 'renting', 'guide', 'beginners'],
    featured: true,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
                content: `# First Time Renting? Here's Your Complete Guide

Renting your first apartment or house can be both **exciting and overwhelming**. This comprehensive guide will walk you through every step of the process, from searching for properties to signing your lease.

## Before You Start Searching

### 1. Determine Your Budget
* Calculate your monthly income and expenses
* Aim to spend no more than **30% of your gross income** on rent
* Don't forget to factor in utilities, internet, and other monthly costs
* Save for a security deposit (usually 1-2 months' rent)

### 2. Know What You Need
* Number of bedrooms and bathrooms
* Preferred neighborhoods or areas
* Must-have amenities (parking, laundry, etc.)
* Pet policies if you have pets
* Proximity to work, school, or public transportation

### 3. Gather Required Documents
* Government-issued ID
* Proof of income (pay stubs, employment letter)
* Bank statements
* References (previous landlords, employers)
* Credit report (you can get one free annually)

## The Search Process

### 1. Use Multiple Sources
* **Online rental platforms** like Homiio
* Local classified ads
* Real estate agents
* Property management companies
* Social media groups

### 2. Be Prepared to Act Quickly
* Good properties often rent within days
* Have your documents ready
* Be available for viewings on short notice
* Have a list of questions prepared

### 3. Schedule Viewings
* Visit properties during daylight hours
* Take photos and notes
* Check cell phone reception
* Test appliances and fixtures
* Ask about maintenance and repairs

## What to Look For During Viewings

### Physical Condition
* Check for signs of water damage
* Test all lights and electrical outlets
* Look for pests or signs of infestation
* Check heating and cooling systems
* Inspect windows and doors

### Safety and Security
* **Locks on doors and windows**
* Smoke detectors and carbon monoxide detectors
* Emergency exits
* Neighborhood safety
* Parking security

### Amenities and Services
* Laundry facilities
* Parking availability
* Storage space
* Internet and cable options
* Garbage and recycling services

## Understanding the Application Process

### 1. Application Requirements
* Completed rental application
* Application fee (varies by location)
* Credit check authorization
* Background check authorization
* Proof of income and employment

### 2. What Landlords Look For
* **Stable income** (usually 2.5-3x rent)
* **Good credit score** (650+ preferred)
* Clean rental history
* Stable employment
* Positive references

### 3. Application Timeline
* Applications typically take **1-3 business days**
* Be prepared to provide additional documentation
* Follow up if you haven't heard back within a week

## Signing Your Lease

### 1. Read Everything Carefully
* **Don't sign anything you don't understand**
* Ask questions about unclear terms
* Get everything in writing
* Keep copies of all documents

### 2. Important Lease Terms
* **Rent amount and due date**
* Security deposit amount and conditions
* Lease term (start and end dates)
* Renewal options
* Pet policies and fees
* Utility responsibilities

### 3. Before Moving In
* Complete a move-in inspection
* Take photos of any existing damage
* Get keys and parking permits
* Set up utilities in your name
* Purchase renters insurance

## Moving In and Beyond

### 1. Moving Day
* Schedule movers or rent a truck
* Change your address with USPS
* Update your address with important services
* Meet your neighbors
* Familiarize yourself with building rules

### 2. During Your Tenancy
* **Pay rent on time**
* Report maintenance issues promptly
* Keep the property clean and undamaged
* Follow building rules and quiet hours
* Communicate with your landlord professionally

### 3. Planning for the Future
* Start saving for your next move
* Build a good relationship with your landlord
* Keep records of all communications
* Know your rights as a tenant
* Consider renters insurance

## Common Mistakes to Avoid

1. **Not reading the lease carefully** - This is a legally binding document
2. **Not documenting move-in condition** - Protect your security deposit
3. **Not having renters insurance** - Protect your belongings
4. **Not reporting maintenance issues** - Small problems can become big ones
5. **Not knowing your rights** - Familiarize yourself with tenant laws in your area

## Resources and Support

* **Local tenant rights organizations**
* Legal aid services
* Housing counseling agencies
* Online tenant forums and communities
* Your state's housing authority

> **Remember**, renting your first place is a learning experience. Don't be afraid to ask questions and seek help when needed. With proper preparation and knowledge, you'll find a great place to call home!
    `
  },
  {
    id: 'avoid-scams',
    slug: 'how-to-avoid-rental-scams',
    title: 'How to Avoid Rental Scams: Red Flags to Watch For',
    description: 'Learn to identify common rental scams and protect yourself from fraud when searching for a new home.',
    category: 'safety',
    readTime: '7 min read',
    publishDate: '1 week ago',
    icon: 'shield-checkmark',
    gradientColors: ['#16a34a', '#22c55e'],
    author: 'Homiio Team',
    tags: ['scams', 'safety', 'fraud', 'protection'],
    featured: true,
    createdAt: '2024-01-10T14:30:00Z',
    updatedAt: '2024-01-10T14:30:00Z',
                content: `# How to Avoid Rental Scams: Red Flags to Watch For

Rental scams are unfortunately **common**, especially in competitive housing markets. Scammers prey on people's urgency to find housing and their desire for good deals. This guide will help you identify and avoid common rental scams.

## Common Types of Rental Scams

### 1. Phantom Rentals
**What it is:** Properties that don't exist or aren't actually for rent  
**How it works:** Scammers create fake listings with stolen photos and descriptions  
**Red flags:**
* Property doesn't exist at the listed address
* Photos look too perfect or professional
* Listing appears on multiple sites with different contact info
* Price is significantly below market rate

### 2. Hijacked Listings
**What it is:** Real properties listed by fake landlords  
**How it works:** Scammers copy legitimate listings and change contact information  
**Red flags:**
* Contact information doesn't match property owner
* Listing appears on multiple sites with different contact info
* Landlord can't provide proof of ownership
* Refuses to meet in person or show the property

### 3. Advance Fee Scams
**What it is:** Demanding money before showing the property  
**How it works:** Scammers ask for application fees, deposits, or "holding fees" upfront  
**Red flags:**
* Asked to pay before seeing the property
* Pressure to act quickly
* Requests for wire transfers or gift cards
* Refuses to accept checks or credit cards

### 4. Bait and Switch
**What it is:** Advertising one property but showing another  
**How it works:** Scammers advertise a desirable property but show a different, often inferior one  
**Red flags:**
* Property shown doesn't match the listing
* Excuses about why the advertised property isn't available
* Pressure to rent the alternative property
* Significantly different terms or conditions

## Red Flags to Watch For

### 1. Too Good to Be True
* **Rent significantly below market rate**
* Luxury amenities at bargain prices
* No application process or background checks
* Immediate availability with no waiting list

### 2. Communication Issues
* Poor grammar and spelling in communications
* Refuses to speak on the phone
* Only communicates via email or text
* Claims to be out of the country or unavailable
* Uses generic email addresses

### 3. Payment Demands
* **Requests for wire transfers or gift cards**
* Asks for payment before meeting or seeing the property
* Demands cash payments only
* Requests personal financial information upfront
* Asks for copies of personal documents before application

### 4. Property Access Issues
* Can't provide access to the property
* Claims the property is occupied but will be available soon
* Refuses to meet in person
* Can't provide keys or access codes
* Makes excuses about why you can't see the property

### 5. Documentation Problems
* Can't provide proof of ownership
* Refuses to show identification
* Won't provide a lease agreement
* Asks you to sign documents without reading them
* Claims to be the owner but can't prove it

## How to Protect Yourself

### 1. Research the Property
* **Verify the property exists** at the listed address
* Check property records with your local assessor's office
* Search for the property on multiple listing sites
* Look for duplicate listings with different contact information
* Use Google Street View to verify the property

### 2. Research the Landlord
* Ask for proof of ownership or management authority
* Verify the landlord's identity
* Check if they're licensed (if required in your area)
* Search for reviews or complaints online
* Contact the property management company directly

### 3. Never Pay Before Seeing
* **Never pay application fees** before seeing the property
* **Never pay deposits** without a signed lease
* **Never use wire transfers or gift cards**
* Always get receipts for any payments
* Use checks or credit cards when possible

### 4. Meet in Person
* **Always meet the landlord** or property manager in person
* View the property in person before applying
* Don't rent sight unseen
* Bring someone with you to viewings
* Meet at the property, not at a coffee shop or office

### 5. Read Everything Carefully
* **Read the lease agreement thoroughly**
* Don't sign anything you don't understand
* Ask questions about unclear terms
* Get everything in writing
* Keep copies of all documents

## What to Do If You're Scammed

### 1. Stop All Communication
* **Don't send any more money**
* Stop responding to the scammer
* Save all communications and documents
* Don't provide any additional personal information

### 2. Report the Scam
* File a report with your local police
* Report to the **Federal Trade Commission (FTC)**
* Report to the **Internet Crime Complaint Center (IC3)**
* Report to the rental platform where you found the listing
* Report to your state's attorney general

### 3. Protect Your Identity
* **Monitor your credit reports**
* Place a fraud alert on your credit
* Consider freezing your credit
* Monitor your bank accounts
* Report any unauthorized charges

### 4. Seek Legal Help
* Contact a consumer protection attorney
* Contact legal aid services
* Contact your state's consumer protection agency
* Consider small claims court if you lost money

## Legitimate Rental Process

### What to Expect
1. **Property viewing** - Always see the property in person
2. **Application process** - Background check, credit check, references
3. **Lease signing** - Detailed contract with all terms
4. **Payment** - Security deposit and first month's rent
5. **Move-in** - Keys and property access

### Normal Timeline
* Application review: **1-3 business days**
* Lease signing: After application approval
* Payment: At lease signing
* Move-in: Usually 1-2 weeks after approval

### Required Documents
* Government-issued ID
* Proof of income
* References
* Credit report
* Rental history

## Additional Resources

* **[Federal Trade Commission](https://ftc.gov)** - ftc.gov
* **[Internet Crime Complaint Center](https://ic3.gov)** - ic3.gov
* **[Better Business Bureau](https://bbb.org)** - bbb.org
* **Local tenant rights organizations**
* **State consumer protection agencies**

> **Remember**, if something seems too good to be true, it probably is. Trust your instincts and don't let urgency cloud your judgment. Taking the time to verify everything can save you from becoming a victim of rental fraud.
    `
  },
  {
    id: 'rental-agreement',
    slug: 'understanding-rental-agreements',
    title: 'Understanding Your Rental Agreement: Key Terms Explained',
    description: 'Break down complex legal terms and understand what you\'re signing before committing to a rental.',
    category: 'legal',
    readTime: '8 min read',
    publishDate: '3 days ago',
    icon: 'document-text',
    gradientColors: ['#f59e0b', '#fbbf24'],
    author: 'Homiio Team',
    tags: ['legal', 'contract', 'lease', 'terms'],
    featured: true,
    createdAt: '2024-01-12T09:15:00Z',
    updatedAt: '2024-01-12T09:15:00Z',
    content: `
# Understanding Your Rental Agreement: Key Terms Explained

Your rental agreement (lease) is a legally binding contract between you and your landlord. Understanding every term is crucial to protecting your rights and avoiding problems. This guide breaks down the most important terms you'll encounter.

## Essential Lease Terms

### 1. Parties to the Agreement
**What it means:** Who is involved in the contract
**Look for:**
- Your name and the landlord's name
- Property management company information
- Co-signers or guarantors
- Roommates and their responsibilities

**Important:** Make sure all roommates are listed on the lease. If someone isn't on the lease, they have no legal right to live there.

### 2. Property Description
**What it means:** What you're renting
**Look for:**
- Complete address including unit number
- What's included (furniture, appliances, parking)
- What's not included
- Common areas you have access to

**Important:** Verify the address matches the property you viewed.

### 3. Lease Term
**What it means:** How long the lease lasts
**Look for:**
- Start date and end date
- Whether it's a fixed-term or month-to-month lease
- Renewal options and procedures
- Early termination conditions

**Important:** Know when your lease expires and what happens if you want to stay longer.

### 4. Rent Amount and Due Date
**What it means:** How much you pay and when
**Look for:**
- Monthly rent amount
- When rent is due (usually the 1st of the month)
- Late fees and grace periods
- How to pay rent (check, online, etc.)
- Rent increases and when they can happen

**Important:** Late fees can add up quickly. Always pay on time.

### 5. Security Deposit
**What it means:** Money held as security against damage
**Look for:**
- Amount of security deposit
- When it's due
- Conditions for return
- Interest on the deposit (if required by law)
- What constitutes "normal wear and tear"

**Important:** Document the condition of the property when you move in and out.

## Utility and Service Terms

### 1. Utilities
**What it means:** Who pays for what services
**Look for:**
- Which utilities you're responsible for
- Which utilities the landlord pays
- How utility bills are handled
- What happens if utilities are cut off

**Common utilities:**
- Electricity
- Gas
- Water and sewer
- Internet and cable
- Garbage and recycling

### 2. Maintenance and Repairs
**What it means:** Who fixes what and when
**Look for:**
- What repairs you're responsible for
- What repairs the landlord handles
- How to report maintenance issues
- Emergency repair procedures
- Response time requirements

**Important:** Know the difference between emergency and non-emergency repairs.

### 3. Property Access
**What it means:** When the landlord can enter your unit
**Look for:**
- Notice requirements (usually 24-48 hours)
- Emergency access procedures
- Reasons for entry (repairs, inspections, showings)
- Your right to privacy

**Important:** Landlords must give notice except in emergencies.

## Rules and Restrictions

### 1. Occupancy Limits
**What it means:** How many people can live in the unit
**Look for:**
- Maximum number of occupants
- Guest policies
- Subletting rules
- Roommate policies

**Important:** Violating occupancy limits can result in eviction.

### 2. Pet Policies
**What it means:** Rules about pets
**Look for:**
- Whether pets are allowed
- Types of pets permitted
- Pet deposits and fees
- Pet size and breed restrictions
- Pet behavior requirements

**Important:** Service animals are protected by law and can't be denied.

### 3. Noise and Behavior
**What it means:** Rules about conduct
**Look for:**
- Quiet hours
- Noise restrictions
- Prohibited activities
- Smoking policies
- Parking rules

**Important:** These rules apply to you and your guests.

## Financial Terms

### 1. Fees and Charges
**What it means:** Additional costs beyond rent
**Look for:**
- Application fees
- Late fees
- NSF (bounced check) fees
- Maintenance fees
- Amenity fees

**Important:** Some fees may be negotiable or illegal in your area.

### 2. Rent Increases
**What it means:** When and how rent can go up
**Look for:**
- How much notice is required
- How often rent can increase
- Maximum increase amounts
- Renewal terms

**Important:** Rent control laws may limit increases in some areas.

### 3. Insurance Requirements
**What it means:** What insurance you need
**Look for:**
- Whether renters insurance is required
- Minimum coverage amounts
- Named insured requirements
- Proof of insurance requirements

**Important:** Renters insurance protects your belongings, not the building.

## Termination and Renewal

### 1. Early Termination
**What it means:** Ending the lease before it expires
**Look for:**
- Early termination fees
- Notice requirements
- Subletting options
- Military clause (if applicable)

**Important:** Breaking a lease can be expensive and affect your credit.

### 2. Renewal Options
**What it means:** Extending your lease
**Look for:**
- Automatic renewal terms
- Notice requirements
- Rent changes upon renewal
- Renewal fees

**Important:** Don't assume your lease will automatically renew.

### 3. Move-Out Procedures
**What it means:** What you need to do when leaving
**Look for:**
- Notice requirements
- Cleaning requirements
- Key return procedures
- Final inspection procedures

**Important:** Follow move-out procedures to get your deposit back.

## Legal Rights and Responsibilities

### 1. Your Rights
- Right to quiet enjoyment
- Right to privacy
- Right to habitable conditions
- Right to repairs
- Right to due process

### 2. Your Responsibilities
- Pay rent on time
- Keep the property clean and undamaged
- Follow building rules
- Report maintenance issues
- Allow reasonable access for repairs

### 3. Landlord's Rights
- Collect rent on time
- Enter for repairs and inspections
- Enforce lease terms
- Evict for violations
- Sell or refinance the property

### 4. Landlord's Responsibilities
- Maintain habitable conditions
- Make necessary repairs
- Provide essential services
- Follow eviction procedures
- Return security deposit

## Red Flags to Watch For

### 1. Unusual Terms
- Waiving your rights
- Excessive fees
- Unreasonable restrictions
- Unclear language
- Missing essential terms

### 2. Illegal Terms
- Discriminatory provisions
- Waiving landlord responsibilities
- Excessive late fees
- Unreasonable access terms
- Prohibited activities

### 3. Missing Information
- Incomplete property description
- Missing contact information
- Unclear payment terms
- No maintenance procedures
- Missing move-out procedures

## Before You Sign

### 1. Read Everything
- Read the entire lease
- Don't sign anything you don't understand
- Ask questions about unclear terms
- Get explanations in writing

### 2. Negotiate Terms
- Some terms may be negotiable
- Ask for changes in writing
- Don't be afraid to walk away
- Consider having a lawyer review

### 3. Get Everything in Writing
- Verbal agreements aren't binding
- Get all promises in writing
- Keep copies of everything
- Document all communications

## After You Sign

### 1. Keep Records
- Copy of signed lease
- All correspondence
- Payment receipts
- Maintenance requests
- Photos of property condition

### 2. Follow the Terms
- Pay rent on time
- Follow all rules
- Report problems promptly
- Keep the property clean

### 3. Know Your Rights
- Research tenant rights in your area
- Join tenant organizations
- Keep up with changes in the law
- Don't be afraid to assert your rights

## Resources for Help

- **Local tenant rights organizations**
- **Legal aid services**
- **State housing authorities**
- **Consumer protection agencies**
- **Online tenant forums**

Remember, a lease is a legal contract. Take the time to understand every term before signing. If something doesn't seem right, don't be afraid to ask questions or seek legal advice.
    `
  },
  {
    id: 'property-inspection',
    slug: 'property-inspection-checklist',
    title: 'Property Inspection Checklist: What to Look For',
    description: 'A comprehensive guide to inspecting potential rental properties and identifying potential issues.',
    category: 'inspection',
    readTime: '6 min read',
    publishDate: '5 days ago',
    icon: 'home',
    gradientColors: ['#8b5cf6', '#a855f7'],
    author: 'Homiio Team',
    tags: ['inspection', 'checklist', 'property', 'viewing'],
    featured: true,
    createdAt: '2024-01-08T16:45:00Z',
    updatedAt: '2024-01-08T16:45:00Z',
    content: `
# Property Inspection Checklist: What to Look For

A thorough property inspection is crucial before signing a lease. This comprehensive checklist will help you identify potential issues and ensure you're making an informed decision about your new home.

## Before the Inspection

### 1. Prepare Your Tools
- Flashlight
- Camera or smartphone
- Notepad and pen
- Measuring tape
- Small mirror (for checking behind appliances)
- Phone charger (to test outlets)

### 2. Research the Area
- Check crime statistics
- Research school ratings
- Look up public transportation options
- Check for nearby amenities
- Research noise levels (airports, highways, etc.)

### 3. Prepare Questions
- Write down specific questions for the landlord
- Research common issues in the area
- Know what's important to you
- Have a list of deal-breakers ready

## Exterior Inspection

### 1. Building Structure
- **Foundation:** Look for cracks, settling, or water damage
- **Exterior walls:** Check for damage, peeling paint, or structural issues
- **Roof:** Look for missing shingles, leaks, or damage
- **Windows:** Check for cracks, proper sealing, and functionality
- **Doors:** Ensure they close properly and have working locks

### 2. Safety Features
- **Fire escapes:** Verify they're accessible and in good condition
- **Emergency exits:** Check that all exits are clear and functional
- **Security:** Look for adequate lighting and security measures
- **Parking:** Check parking availability and security

### 3. Common Areas
- **Hallways:** Check cleanliness and lighting
- **Stairwells:** Ensure they're well-lit and safe
- **Laundry facilities:** Check availability and condition
- **Storage areas:** Look for available storage options

## Interior Inspection - Room by Room

### Living Room
- **Walls and ceilings:** Look for cracks, water damage, or mold
- **Flooring:** Check for damage, stains, or uneven surfaces
- **Windows:** Test opening/closing, check for drafts
- **Electrical outlets:** Test all outlets and check for loose wiring
- **Lighting:** Ensure all lights work and have adequate fixtures
- **Heating/cooling:** Test thermostat and vents
- **Closet space:** Check size and condition

### Kitchen
- **Appliances:** Test all appliances (stove, refrigerator, dishwasher)
- **Cabinets:** Check for damage, proper closing, and adequate storage
- **Countertops:** Look for damage, stains, or loose sections
- **Sink:** Test water pressure and check for leaks
- **Garbage disposal:** Test if present
- **Ventilation:** Check range hood and ventilation
- **Electrical:** Ensure adequate outlets for appliances

### Bedrooms
- **Size:** Measure rooms to ensure they fit your furniture
- **Closets:** Check size and condition
- **Windows:** Test opening/closing and check for security
- **Electrical:** Test outlets and check for adequate lighting
- **Heating/cooling:** Check vents and temperature control
- **Sound:** Listen for noise from neighbors or outside

### Bathroom
- **Fixtures:** Test toilet, sink, and shower/tub
- **Water pressure:** Check hot and cold water pressure
- **Drainage:** Test how quickly water drains
- **Ventilation:** Check for exhaust fan and window
- **Mold:** Look for signs of mold or mildew
- **Storage:** Check for adequate storage space
- **Privacy:** Ensure adequate privacy measures

### Utility Areas
- **Water heater:** Check age and condition
- **Furnace/AC:** Test operation and check filters
- **Electrical panel:** Check for any obvious issues
- **Washer/dryer:** Test if included or check hookups
- **Storage:** Look for additional storage options

## Systems and Utilities

### 1. Electrical System
- **Outlets:** Test all outlets in each room
- **Lighting:** Ensure all lights work properly
- **Circuit breaker:** Check for any tripped breakers
- **Wiring:** Look for exposed or damaged wiring
- **Capacity:** Ensure adequate electrical capacity

### 2. Plumbing System
- **Water pressure:** Test in all fixtures
- **Hot water:** Check temperature and availability
- **Drainage:** Test all drains for proper flow
- **Leaks:** Look for signs of water damage
- **Water quality:** Check for discoloration or odd taste

### 3. Heating and Cooling
- **Furnace:** Test operation and check filters
- **Air conditioning:** Test if present
- **Thermostat:** Check functionality
- **Vents:** Ensure all vents are clear and functional
- **Insulation:** Check for adequate insulation

### 4. Internet and Cable
- **Phone lines:** Check for phone jacks if needed
- **Cable outlets:** Check for cable TV connections
- **Internet:** Ask about internet options and speeds
- **Cell reception:** Test cell phone signal strength

## Safety and Security

### 1. Fire Safety
- **Smoke detectors:** Check for working smoke detectors
- **Carbon monoxide detectors:** Verify if present
- **Fire extinguishers:** Check for availability
- **Fire escapes:** Ensure accessibility
- **Emergency exits:** Verify all exits are clear

### 2. Security
- **Locks:** Test all door and window locks
- **Deadbolts:** Check for adequate security
- **Peepholes:** Verify if present on exterior doors
- **Lighting:** Check exterior lighting
- **Neighborhood:** Assess overall security

### 3. Emergency Preparedness
- **Emergency contacts:** Get landlord emergency contact
- **Emergency procedures:** Ask about emergency protocols
- **Insurance:** Check if renters insurance is required
- **Evacuation:** Know evacuation routes

## Environmental Factors

### 1. Air Quality
- **Ventilation:** Check for adequate air flow
- **Mold:** Look for signs of mold or mildew
- **Odors:** Note any unusual or unpleasant odors
- **Allergens:** Check for potential allergen sources

### 2. Noise Levels
- **Neighbors:** Listen for noise from adjacent units
- **Street noise:** Check for traffic or other street noise
- **Building noise:** Listen for HVAC or other building systems
- **Quiet hours:** Ask about building quiet hours

### 3. Natural Light
- **Windows:** Check amount and quality of natural light
- **Orientation:** Note which direction windows face
- **Shading:** Check for trees or buildings blocking light
- **Privacy:** Ensure adequate privacy with natural light

## Documentation

### 1. Take Photos
- **Overall condition:** Document general condition
- **Damage:** Photograph any existing damage
- **Appliances:** Document appliance condition
- **Measurements:** Take photos of room measurements

### 2. Make Notes
- **Issues found:** Document all problems
- **Questions:** Note questions for landlord
- **Measurements:** Record room dimensions
- **Features:** Note positive features

### 3. Ask Questions
- **Maintenance history:** Ask about recent repairs
- **Upcoming work:** Check for planned maintenance
- **Policies:** Clarify building policies
- **Utilities:** Confirm utility responsibilities

## Red Flags to Watch For

### 1. Major Issues
- **Structural damage:** Cracks, settling, or foundation issues
- **Water damage:** Stains, mold, or active leaks
- **Electrical problems:** Exposed wiring or frequent outages
- **Plumbing issues:** Low pressure or drainage problems
- **Safety hazards:** Missing smoke detectors or security issues

### 2. Maintenance Issues
- **Deferred maintenance:** Signs of neglect
- **Broken appliances:** Non-functioning equipment
- **Dirty conditions:** Poor cleanliness
- **Pest problems:** Signs of insects or rodents
- **Odors:** Unpleasant or suspicious smells

### 3. Management Issues
- **Unresponsive landlord:** Difficulty getting responses
- **Rushed viewing:** Pressure to make quick decisions
- **Hidden problems:** Attempts to hide issues
- **Unclear policies:** Vague or contradictory rules
- **Poor communication:** Difficulty getting information

## After the Inspection

### 1. Review Your Notes
- Go through all your notes and photos
- Prioritize issues by importance
- Make a list of questions for the landlord
- Decide if issues are deal-breakers

### 2. Follow Up
- Ask for repairs before signing
- Get promises in writing
- Request a second viewing if needed
- Don't feel pressured to decide immediately

### 3. Compare Options
- Compare with other properties you've seen
- Consider the total cost including utilities
- Factor in commute time and transportation
- Think about long-term suitability

## Negotiation Points

### 1. Repairs
- Request repairs before move-in
- Get repair timeline in writing
- Consider asking for rent reduction for major issues
- Don't accept promises without documentation

### 2. Improvements
- Ask about planned improvements
- Request upgrades if needed
- Negotiate for additional amenities
- Consider asking for flexible lease terms

### 3. Costs
- Negotiate rent if issues are found
- Ask about utility costs and averages
- Request fee waivers for application or move-in
- Consider asking for flexible payment terms

## Final Decision

### 1. Trust Your Instincts
- If something feels wrong, it probably is
- Don't ignore red flags
- Consider the overall feeling of the place
- Think about your comfort and safety

### 2. Consider Alternatives
- Don't settle for a problematic property
- Keep looking if needed
- Consider different neighborhoods or building types
- Be patient in your search

### 3. Get Everything in Writing
- Document all agreements
- Get repair promises in writing
- Keep copies of all communications
- Don't rely on verbal agreements

Remember, a thorough inspection can save you from major problems later. Take your time, be thorough, and don't be afraid to walk away if you find too many issues. Your home should be a safe, comfortable place to live.
    `
  }
];

// Get all tips/articles
export const getAllTips = async (req: Request, res: Response) => {
  try {
    // In production, this would query the database
    // const tips = await Tip.find({ published: true }).sort({ createdAt: -1 });
    
    const tips = mockTipsData.map(tip => ({
      id: tip.id,
      slug: tip.slug,
      title: tip.title,
      description: tip.description,
      category: tip.category,
      readTime: tip.readTime,
      publishDate: tip.publishDate,
      icon: tip.icon,
      gradientColors: tip.gradientColors,
      author: tip.author,
      tags: tip.tags,
      featured: tip.featured,
      createdAt: tip.createdAt,
      updatedAt: tip.updatedAt
    }));

    res.json({
      success: true,
      data: tips,
      total: tips.length
    });
  } catch (error) {
    console.error('Error fetching tips:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tips',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get a single tip/article by ID or slug
export const getTipById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // In production, this would query the database
    // const tip = await Tip.findOne({ 
    //   $or: [{ _id: id }, { slug: id }], 
    //   published: true 
    // });
    
    const tip = mockTipsData.find(t => t.id === id || t.slug === id);
    
    if (!tip) {
      return res.status(404).json({
        success: false,
        message: 'Tip not found'
      });
    }

    res.json({
      success: true,
      data: tip
    });
  } catch (error) {
    console.error('Error fetching tip:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tip',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get tips by category
export const getTipsByCategory = async (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    
    // In production, this would query the database
    // const tips = await Tip.find({ 
    //   category: category, 
    //   published: true 
    // }).sort({ createdAt: -1 });
    
    const tips = mockTipsData.filter(tip => tip.category === category);

    res.json({
      success: true,
      data: tips,
      total: tips.length
    });
  } catch (error) {
    console.error('Error fetching tips by category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tips by category',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get featured tips
export const getFeaturedTips = async (req: Request, res: Response) => {
  try {
    const { limit = 4 } = req.query;
    
    // In production, this would query the database
    // const tips = await Tip.find({ 
    //   featured: true, 
    //   published: true 
    // }).sort({ createdAt: -1 }).limit(Number(limit));
    
    const tips = mockTipsData
      .filter(tip => tip.featured)
      .slice(0, Number(limit));

    res.json({
      success: true,
      data: tips,
      total: tips.length
    });
  } catch (error) {
    console.error('Error fetching featured tips:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch featured tips',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Search tips
export const searchTips = async (req: Request, res: Response) => {
  try {
    const { q, category, tag } = req.query;
    
    // In production, this would query the database with proper search
    // let query = { published: true };
    // if (q) query.$text = { $search: q };
    // if (category) query.category = category;
    // if (tag) query.tags = tag;
    // const tips = await Tip.find(query).sort({ createdAt: -1 });
    
    let tips = mockTipsData;
    
    if (q) {
      const searchTerm = q.toString().toLowerCase();
      tips = tips.filter(tip => 
        tip.title.toLowerCase().includes(searchTerm) ||
        tip.description.toLowerCase().includes(searchTerm) ||
        tip.content.toLowerCase().includes(searchTerm) ||
        tip.tags.some(tag => tag.toLowerCase().includes(searchTerm))
      );
    }
    
    if (category) {
      tips = tips.filter(tip => tip.category === category);
    }
    
    if (tag) {
      tips = tips.filter(tip => tip.tags.includes(tag.toString()));
    }

    res.json({
      success: true,
      data: tips,
      total: tips.length
    });
  } catch (error) {
    console.error('Error searching tips:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search tips',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

module.exports = {
  getAllTips,
  getTipById,
  getTipsByCategory,
  getFeaturedTips,
  searchTips
}; 