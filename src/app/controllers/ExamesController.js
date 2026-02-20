import * as Yup from 'yup';
import Exames from '../models/Exames.js';



class ExamesController {

    async store(req, res) {
        const schema = Yup.object({
            possui_exame: Yup.boolean().required(),

            prestador_medico_id: Yup.number().when('possui_exame', {
                is: true,
                then: (schema) => schema.required('O ID do prestador médico é obrigatório'),
                otherwise: (schema) => schema.notRequired()
            }),

            nome_exame: Yup.string().when('possui_exame', {
                is: true,
                then: (schema) => schema.required('O nome do exame é obrigatório'),
                otherwise: (schema) => schema.notRequired()
            }),

            tipo_exame: Yup.string().when('possui_exame', {
                is: true,
                then: (schema) => schema.oneOf(['sangue', 'imagem', 'biópsia', 'outro']).required('O tipo do exame é obrigatório'),
                otherwise: (schema) => schema.notRequired()
            }),

            resultado_exame: Yup.string().when('possui_exame', {
                is: true,
                then: (schema) => schema.required('O resultado do exame é obrigatório'),
                otherwise: (schema) => schema.notRequired()
            }),

            data_exame_realizado: Yup.date().when('possui_exame', {
                is: true,
                then: (schema) => schema.required('A data de realização do exame é obrigatória'),
                otherwise: (schema) => schema.notRequired()
            }),

            data_exame_resultado: Yup.date().when('possui_exame', {
                is: true,
                then: (schema) => schema.required('A data do resultado do exame é obrigatória'),
                otherwise: (schema) => schema.notRequired()
            })
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            console.log('Erro de validação:', err);
            return res.status(400).json({ error: 'Validação falhou', messages: err.inner });
        }

        console.log(req.body)

        const exame = await Exames.create(req.body);

        return res.status(201).json(exame);
    }
}


export default new ExamesController();