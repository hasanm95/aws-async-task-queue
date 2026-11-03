
exports.handler = async (event) => {
    console.log(JSON.parse(event, null, 2))
}