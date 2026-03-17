import * as Yup from 'yup'
import User from '../models/User.js'
import Perfil from '../models/Perfil.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import authConfig from '../../config/auth.js'

class SessionController {
    async store(req, res) {

        const schema = Yup.object({
            email: Yup.string().email().required(),
            password: Yup.string().required()
        })

        try {
            await schema.validate(req.body, { abortEarly: false })
        }
        catch (err) {
            return res.status(400).json({ error: 'Validation fails', messages: err.error })
        }

        const { email, password } = req.body

        // NORMALIZAÇÃO AQUI: Remove espaços em branco e deixa tudo minúsculo
        const normalizedEmail = email.trim().toLowerCase();

        const user = await User.findOne({ 
            where: { email: normalizedEmail }, // Usa o e-mail normalizado
            include: [{
                model: Perfil,
                as: 'perfil',
                attributes: ['id', 'nome', 'permissoes']
            }]
        })

        if (!user) {
            return res.status(401).json({ error: 'email or password is invalid' })
        }
        
        const password_hash = await bcrypt.compare(password, user.password_hash)

        if (!password_hash) {
            return res.status(401).json({ error: 'email or password is invalid' })
        }

        const token = jwt.sign({ id: user.id }, authConfig.secret, {
            expiresIn: authConfig.expiresIn
        })

        return res.status(201).json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                active: user.active,
                is_admin: user.is_admin, 
                is_new_user: user.is_new_user,
                perfil: user.perfil 
            }, 
            token
        })
    }
}

export default new SessionController()