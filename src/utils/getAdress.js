import axios from "axios";



export default async function getAdress(cep) {

    const address = []
    const cleanCep = cep.replace(/\D/g, ''); // Remove caracteres não numéricos
    
    try {
        const {data} = await axios.get(`https://viacep.com.br/ws/${cleanCep}/json/`);
        address.push(data)
        return address;
    } catch (error) {
        console.error("Erro ao buscar endereço:", error);
        throw error;
    }


}
