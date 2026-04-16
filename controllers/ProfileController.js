const axios = require("axios");
const {prisma }= require("./dbController");

const getAgeGroup = (age)=>{
    if(age <=12) return "child";
    if(age<= 19) return "teenager";
    if(age<=59) return "adult";
    return "senior";
}

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

        // save to DB
        const profile = await prisma.Profile.create({
            data: {
                id: require("uuid").v7(),
                name,
                gender: genderData.gender,
                gender_probability: genderData.probability,
                sample_size: genderData.count,
                age: ageData.age,
                age_group,
                country_id: topCountry.country_id,
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
    const {gender, country_id, age_group} = req.query;

    const filters = {};

    if(gender) filters.gender = gender.toLowerCase();
    if(country_id) filters.country_id = country_id.toUpperCase();
    if(age_group) filters.age_group = age_group.toLowerCase();

    const profiles = await prisma.Profile.findMany({
        where: filters
    });

    res.json({
        status: "success",
        count: profiles.length,
        data: profiles.map(p =>({
            id: p.id,
            name: p.name,
            gender: p.gender,
            age: p.age,
            age_group: p.age_group,
            country_id: p.country_id
        }))
    });
};


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
