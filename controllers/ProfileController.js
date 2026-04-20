const axios = require("axios");

const {prisma }= require("./dbController");
const {parseNLQuery } = require("../utils/nlpParser");

const getAgeGroup = (age)=>{
    if(age <=12) return "child";
    if(age<= 19) return "teenager";
    if(age<=59) return "adult";
    return "senior";
}

const VALID_SORT_FIELDS = ['age', 'created_at', 'gender_probability'];
const VALID_ORDERS = ['asc', 'desc'];
const MAX_LIMIT = 50;

exports.getProfiles  = async (req, res)=>{
    try{
        let {name } = req.body;

        // validation
        if(!name){
            return res.status(400).json({
                status: "error",
                message: "Name is required"
            });
        }

        if(typeof name !== "string"){
            return res.status(422).json({
                status: "error",
                message: "Invalid type"
            });
        }

        name = name.trim().toLowerCase();

        // Check duplicate (IDEMPOTENCY)
        const existing = await prisma.Profile.findUnique({
            where: {name}
        });

        if(existing){
            return res.status(200).json({
                status: "success",
                message: "Profile already exist",
                data: existing
            });

        }

        // call external APIs (Parallel = fast)
        const [genderRes, ageRes, nationRes ] = await Promise.all([
            axios.get(`https://api.genderize.io?name=${name}`),

            axios.get(`https://api.agify.io?name=${name}`),

            axios.get(`https://api.nationalize.io?name=${name}`)
        ]);

        const genderData = genderRes.data;
        const ageData = ageRes.data;
        const nationData = nationRes.data;

        // Edge cases 
        if(!genderData.gender || genderData.count === 0){
            return res.status(502).json({
                status: "error",
                message: "Genderize returned an invalid response"
            });
        }

        if(!ageData.age){
            return res.status(502).json({
                status: "error",
                message: "Agify returned an invalid response"
            });
        }

        if(!nationData.country || nationData.country.length=== 0){
            return res.status(502).json({
                status: "error",
                message: "Nationalizze returned an invalid response"
            });
        }

        // processing logic
        const age_group = getAgeGroup(ageData.age);

        const topCountry = nationData.country.reduce((max, curr)=> curr.probability > max.probability ? curr : max);

        const { v7: uuidv7 } = await import('uuid');
        const id = uuidv7();
        // save to DB
        const profile = await prisma.Profile.create({
            data: {
                id: id,
                name,
                gender: genderData.gender,
                gender_probability: genderData.probability,
                age: ageData.age,
                age_group,
                country_id: topCountry.country_id,
                country_name: topCountry.country_id,
                country_probability: topCountry.probability,
                created_at: new Date()
            }
        });

        return res.status(201).json({
            status: "success",
            data: profile
        });

    } catch(error){
        console.log(error)
        return res.status(500).json({
            status: "error",
            message: "Server error"
        });
    }   
};


exports.getSingleProfiles = async (req, res)=>{
    const profile = await prisma.Profile.findUnique({
        where: {id: req.params.id}
    });

    if(!profile){
        return res.status(404).json({
            status: "error",
            message: "Profile not found"
        });

    }

    res.json({
        status: "success",
        data: profile
    })
};

exports.getAllProfilesplusFilter = async (req, res)=>{
    try {
        const {gender, age_group, country_id, min_age, max_age, min_gender_probability, min_country_probability,
            sort_by = 'created_at', order='asc', page='1', limit = '10'
        } = req.query;
    
        
        // Validate sort_by and order
        if(!VALID_SORT_FIELDS.includes(sort_by)){
            return res.status(422).json({ 
                status: "error",
                message: "Invalid query parameters"
            });
    
        }
        if(!VALID_ORDERS.includes(order)){
            return res.status(422).json({
                status: "error", 
                message: "Invalid query parameters"
            });
    
        }
    
        const parsedPage = parseInt(page);
        const parsedLimit = Math.min(parseInt(limit), MAX_LIMIT);
    
        if(isNaN(parsedPage)|| isNaN(parsedLimit)|| parsedPage<1|| parsedLimit <1){
            return res.status(422).json({
                status: "error",
                message: "Invalid query parameters"
            })
        }
    
        // Build where clause
    
        const where = {}
        if(gender) where.gender = gender.toLowerCase();
        if(age_group) where.age_group = age_group.toLowerCase();
        if(country_id) where.country_id = country_id.toUpperCase();
        if(min_age !== undefined|| max_age!==undefined){
            where.age = {};
            if(min_age !== undefined){
                if(isNaN(parseInt(min_age))) return res.status(422).json({status: "error", message: "Invalid query parameter"});
                where.age.gte = parseInt(min_age)
            }
            if(max_age !== undefined){
                if(isNaN(parseInt(max_age))) return res.status(422).json({status: "error", message: "Invalid query parameter"});
                where.age.lte = parseInt(max_age)
            }
        }
        if(min_country_probability !== undefined){
            if(isNaN(parseFloat(min_country_probability))) return res.status(422).json({ status: "error", message: "invalid query parameters"});
            where.country_probability = {gte: parseFloat(min_country_probability)};
        }
    
        const offset = (parsedPage -1) * parsedLimit;
    
        const [total, profiles] = await Promise.all([
            prisma.profile.count({ where }),
            prisma.profile.findMany({
                where,
                orderBy: {[sort_by]: order},
                skip: offset,
                take: parsedLimit,
            })
        ])
    
        res.status(200).json({
            status: "success",
            page: parsedPage,
            limit: parsedLimit,
            total,
            data: profiles
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({status: "error", message: "Server error"})
    }
};


exports.searchProfiles = async (req, res)=>{
    try {

        const {q, page ='1', limit = '10'} = req.query;

        if (!q|| !q.trim()){
            return res.status(400).json({ status: "error", message: "Missing or empty parameter"});
        }

        const filters = parseNLQuery(q);
        if(!filters){
            return res.status(422).json({status: "error", message: "Unable to intepret query"});

        }

        const parsedPage = parseInt(page);
        const parsedLimit = Math.min((parseInt(limit), MAX_LIMIT));

        if(isNaN(parsedPage)|| isNaN(parsedLimit) || parsedPage < 1|| parsedLimit <1){
            return res.status(422).json({ status: "error", message: "Invalid query parameters"});
        }

        // Build where clause
    
        const where = {}
        if(filters.gender) where.gender = filters.gender;
        if(filters.age_group) where.age_group = filters.age_group;
        if(filters.country_id) where.country_id = filters.country_id;
        if(filters.min_age !== undefined|| filters.max_age!==undefined){
            where.age = {};
            if(filters.min_age !== undefined) where.age.gte = filters.min_age;
            if(filters.max_age !== undefined) where.age.lte = filters.max_age;
        }

        const offset = (parsedPage -1 ) * parsedLimit;

        const [total, profiles] = await Promise.all([
            prisma.profile.count({ where }),
            prisma.profile.findMany({
                where,
                orderBy: {created_at: 'asc'},
                skip: offset,
                take: parsedLimit,
            })
        ])

        return res.status(200).json({
            status: "success",
            page: parsedPage,
            limit: parsedLimit,
            total,
            data: profiles
        })
        
    } catch (error) {
        console.error(error);
        return res.status(500).json({status: "error", message: "Server error"})
    }
}


exports.deleteProfile = async (req, res)=>{
    try{
        await prisma.Profile.delete({
            where: {id: req.params.id}
        });

        return res.status(204).send();
    } catch (error){
        res.status(500).json({
            status: "error",
            message: "Profile not found"
        })
    };

}
