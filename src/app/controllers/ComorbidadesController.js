
import * as Yup from 'yup';

import Comorbidade from '../models/Comorbidades.js';

class Comorbidades {
    async store(req, res) {
        const schema = Yup.object({
            nome: Yup.string().required(),
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: 'Validation fails', messages: err.inner });
        }

        const { nome } = req.body;

        // Sugestão de ajuste no Backend (store)
        const comorbidadeExists = await Comorbidade.findOne({ where: { nome } });
        if (comorbidadeExists) {
            return res.status(400).json({ error: 'Comorbidade já cadastrada.' });
        }
        const novaComorbidade = await Comorbidade.create({ nome });
        return res.status(201).json(novaComorbidade);
    }

    async index(req, res) {
        const comorbidades = await Comorbidade.findAll();
        return res.status(200).json(comorbidades);
    }


}


export default new Comorbidades();