const Note = require('../models/Note');
const CustomError = require('../errors');
const {StatusCodes} = require('http-status-codes');
const {checkPermissions} = require('../utils');
const User = require('../models/User');

//title,description,content,user,tags,visibility,likes
const createNote = async(req,res)=>{
    const {tags}= req.body;
    if(!tags){
        throw new CustomError.BadRequestError('Please provide at least one tag');
    }
    req.body.user = req.user.userId;

    const note = await Note.create(req.body);// only the required things will go in the database, others will be ignored if added
    res.status(StatusCodes.CREATED).json({note});
}

// by default sorted to latest(x)
// categories(x),tags,likes,date(latest,oldest)(x),year(x)
const getAllNotes= async(req,res)=>{
    const { year,sort,category,search,orderBy } = req.query;

    let queryObject = {};
    queryObject.visibility='public';
    
    if(year){
        const startDate = new Date(year,0,1);
        const endDate = new Date(year,11,31);

        queryObject.createdAt ={
            $gte:startDate,
            $lte:endDate,
        }
    } 

    //search based on tags
    //We use the $in operator to find documents where the tags array contains any of the tags provided in the search query.
    // if(search){
    //     queryObject.tags = { $in:search.split(',').map(tag => new RegExp(tag, 'i'))}; // Use the RegExp constructor with the 'i' flag to perform a case-insensitive search
    // }

    // using search for both the name and tags
    if (search) {
        const searchRegex = new RegExp(search, 'i');
        queryObject.$or = [
            { tags: { $in: search.split(',').map(tag => new RegExp(tag, 'i')) } }, // Search by tags
            { name: { $regex: searchRegex } } // Search by name (assuming 'name' property exists in the Note model)
        ];
    }
    
    if(category){
        queryObject.category=category;
    }

    let result = Note.find(queryObject);

    // Any of the both below ways can be used to sort based on likes and the createdAt

    if(!sort || sort==='latest' || sort!=='oldest'){
        if(orderBy==='likes')
            result = result.sort('-likes -createdAt');
        else 
            result = result.sort('-createdAt');
    }
    if(sort==='oldest'){
        if(orderBy==='likes')
            result = result.sort('-likes createdAt');
        else
            result = result.sort('createdAt');
    }

    // if (!sort || sort === 'latest') {
    //     if (orderBy === 'likes')
    //         result = result.sort({ likes:-1,createdAt:-1 });
    //     else
    //         result = result.sort({ createdAt: -1 });
    // } else if (sort === 'oldest') {
    //     if (orderBy === 'likes')
    //         result = result.sort({ likes: -1,createdAt: 1});
    //     else
    //         result = result.sort({ createdAt: 1 });
    // }

    //Pagination
    const page=req.query.page||1;
    const limit = req.query.limit||10;
    const skip = (page-1)*limit;

    result.skip(skip).limit(limit);

    const totalNotes = await Note.countDocuments(queryObject);
    const numOfPages = Math.ceil(totalNotes/limit);

    const notes = await result;
    res.status(StatusCodes.OK).json({notes,totalNotes,numOfPages});
}

// user can access it's own private notes
const getSingleNote = async(req,res)=>{
    const {id:noteId} = req.params;
    const note = await Note.findOne({_id:noteId});
    if(!note){
        throw new CustomError.notFoundError(`No note with id: ${noteId}`);
    }

    if((note.visibility==='private' || note.visibility==='unlisted')){
        throw new CustomError.UnauthorizedError('You are not authorized to access this note');
    }

    res.status(StatusCodes.OK).json({note}); 
}

//title,description,content,user,tags,visibility,likes
//frontend send me the complete tags array
const updateNote = async(req,res)=>{
    const{id:noteId} = req.params;
    const {title,description,content,tags,visibility,category}=req.body;
    // console.log(tags);
    const note = await Note.findOne({_id:noteId});
    if(!note){
        throw new CustomError.notFoundError(`No note with id: ${noteId}`);
    }

    if(note.user.toString()!==req.user.userId){
        throw new CustomError.UnauthorizedError('You are not authorized to update this note');
    }

    if(tags){
        note.tags=tags;// findOneAndUpdate mein tags update krne pe error de rha tha tags undefined dikha rha tha
        await note.save();
    }

    const updatedNote = await Note.findOneAndUpdate({_id:noteId},{title,description,content,visibility,category},{new:true,runValidators:true});
    // console.log(updatedNote.tags);

    res.status(StatusCodes.OK).json({updatedNote});
}

const deleteNote = async(req,res)=>{
    const{id:noteId}=req.params;
    const note = await Note.findOne({_id:noteId});
    if(!note){
        throw new CustomError.notFoundError(`No note with id: ${noteId}`);
    }
    checkPermissions(req.user,note.user);
    await note.remove();
    res.status(StatusCodes.OK).json({msg:'Note deleted successfully'});
}

// kis kis ne like kiya vo bhi to aayega model mein
const likeNote = async(req,res)=>{
    const {id:noteId} = req.params;
    const note = await Note.findOne({_id:noteId});
    const user = await User.findOne({_id:req.user.userId});

    if(!note){
        throw new CustomError.notFoundError(`No note found with id : ${noteId}`);
    }

    if(note.visibility !== 'public'){
        throw new CustomError.BadRequestError(`You can't like a ${note.visibility} note`)
    }

    if(note.likedBy.includes(req.user.userId)){
        throw new CustomError.BadRequestError('You have already liked this note');
    }

    note.likes = note.likes+1;
    note.likedBy.push(req.user.userId); // user ke likes update krne ke liye and list ke liye pipeline -> no

    user.numOfLikes=user.numOfLikes+1;
    user.likes.push(noteId);

    // for ex. in E-commerece-API I had productReview instead of like, in which I asked multiple things, so I had to create a different model for review and then update the ratings, and all realtime, but here is's just a like so to update the likes for the user here only
    await note.save();
    await user.save();

    res.status(StatusCodes.OK).json({msg:"Liked succesfully!!"});
}

// can't send the unlike request if already not liked
const unlikeNote = async(req,res)=>
{
    const {id:noteId} = req.params;
    const note = await Note.findOne({_id:noteId});
    const user = await User.findOne({_id:req.user.userId});

    if(!note){
        throw new CustomError.notFoundError(`No note found with id : ${noteId}`);
    }

    if(!(note.visibility === 'public')){
        throw new CustomError.BadRequestError(`You can't unlike a ${note.visibility} note`);
    }

    if(!note.likedBy.includes(req.user.userId)){
        throw new CustomError.BadRequestError(`You have not liked this note`);
    }

    note.likes=note.likes-1;
    note.likedBy=note.likedBy.filter((id)=>id.toString()!==req.user.userId); // removing specific element from array

    user.numOfLikes=user.numOfLikes-1;
    user.likes= user.likes.filter((id)=>id.toString()!==noteId);

    await note.save();
    await user.save();

    res.status(StatusCodes.OK).json({msg:"Unliked succesfully!!"});
}

// user ki ek liked valie list bhi hogi
// getAllNotes getSingleNote createNote updateNote deleteNote
//Add Likes Controller
//comments 
// removing many things at deletion
//likes pipeline

module.exports = {getAllNotes,getSingleNote,createNote,updateNote,deleteNote,likeNote,unlikeNote};